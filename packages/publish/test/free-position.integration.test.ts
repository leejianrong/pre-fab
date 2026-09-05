import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newUlid, DEFAULT_THEME_TOKENS, type PageDocument } from "@prefab/schema";
import { HERO_BLOCK_TYPE, heroDefaultProps, BOOKING_BLOCK_TYPE, bookingDefaultProps } from "@prefab/blocks";
import { buildSiteBundle } from "../src/build.js";

/**
 * ADR-0014 / KAN-1129's render path: the piece that was entirely missing
 * before this slice — a `"free"` page's `position` data existed in the
 * document and was editable in the canvas, but nothing rendered it on the
 * actual published site. This exercises the real publish pipeline
 * (`buildSiteBundle`, the same one every hosted/exported/ejected tier
 * shares) end to end, the same style `form.integration.test.ts` uses to
 * prove a client:load island still ships.
 */
let bundleStoreDir: string;

afterEach(async () => {
  if (bundleStoreDir) await rm(bundleStoreDir, { recursive: true, force: true });
});

function freePageSite() {
  const siteId = newUlid();
  const pageId = newUlid();
  const heroId = newUlid();
  const bookingId = newUlid();

  const pages: PageDocument[] = [
    {
      id: pageId,
      siteId,
      slug: "home",
      title: "Home",
      schemaVersion: 1,
      version: 0,
      layoutMode: "free",
      blocks: [
        {
          id: heroId,
          type: HERO_BLOCK_TYPE,
          parent: null,
          // Deliberately the *later*-inserted block with the *lower*
          // order, so a naive "array order decides the stack" bug would
          // put it on top when ADR-0014 point 4 says the opposite: lower
          // `order` stacks underneath.
          order: 1000,
          schemaVersion: 1,
          props: { ...heroDefaultProps, heading: "Free-positioned hero" },
          responsive: {},
          position: {
            base: { x: 10, y: 20, w: 30, h: 40, rotate: -15, opacity: 0.9 },
            md: { x: 5 },
            lg: { x: 1, y: 2 },
          },
        },
        {
          id: bookingId,
          type: BOOKING_BLOCK_TYPE,
          parent: null,
          order: 2000,
          schemaVersion: 1,
          props: bookingDefaultProps,
          responsive: {},
          position: {
            base: { x: 50, y: 60, w: 20, h: 15, rotate: 0, opacity: 1 },
          },
        },
      ],
    },
  ];

  return {
    site: { id: siteId, slug: "free-demo", name: "Free Demo Site", ownerId: newUlid(), schemaVersion: 1, pages: [{ id: pageId, slug: "home" }] },
    theme: { id: newUlid(), siteId, schemaVersion: 1, tokens: DEFAULT_THEME_TOKENS },
    pages,
    heroId,
    bookingId,
  };
}

describe("buildSiteBundle — free-positioning render path (ADR-0014, KAN-1129)", () => {
  it("wraps each root block on a free page in an absolutely-positioned container inside a relative canvas root", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-"));
    const { site, theme, pages, heroId, bookingId } = freePageSite();

    const result = await buildSiteBundle({ site, theme, pages, bundleStoreDir, runtimeApiUrl: "https://api.example.test" });
    const html = await readFile(path.join(result.bundlePath, "index.html"), "utf8");

    expect(html).toContain('data-pf-free-canvas-root=""');
    expect(html).toContain("Free-positioned hero");

    // The Hero's wrapper carries the base rect as unconditional inline
    // style: position:absolute, percentage left/top/width/height, the
    // rotate transform, and the opacity — exactly the base rect authored
    // above, nothing resolved from md/lg (those are media-query only).
    const heroWrapperStart = html.indexOf(`data-pf-free-block-id="${heroId}"`);
    expect(heroWrapperStart).toBeGreaterThan(-1);
    const heroWrapperTagStart = html.lastIndexOf("<div", heroWrapperStart);
    const heroWrapperTag = html.slice(heroWrapperTagStart, html.indexOf(">", heroWrapperStart) + 1);
    expect(heroWrapperTag).toContain("position:absolute");
    expect(heroWrapperTag).toContain("left:10%");
    expect(heroWrapperTag).toContain("top:20%");
    expect(heroWrapperTag).toContain("width:30%");
    expect(heroWrapperTag).toContain("height:40%");
    expect(heroWrapperTag).toContain("rotate(-15deg)");
    expect(heroWrapperTag).toContain("opacity:0.9");

    // The Hero's own md/lg overrides land in a scoped <style> block, keyed
    // to data-pf-free-block-id (not data-pf-block-id, which is the
    // *content*-styling attribute responsiveStyleCss already owns).
    expect(html).toContain(`[data-pf-free-block-id="${heroId}"]`);
    expect(html).toContain("@media (min-width:640px)");
    expect(html).toContain("left:5% !important");
    expect(html).toContain("@media (min-width:1024px)");
    expect(html).toContain("left:1% !important");
    expect(html).toContain("top:2% !important");

    // The Booking block (a client:load island) gets the identical wrapper
    // treatment as the static Hero — positioning isn't special-cased away
    // for the four islands (ADR-0014/KAN-1129 scope item 4).
    const bookingWrapperStart = html.indexOf(`data-pf-free-block-id="${bookingId}"`);
    expect(bookingWrapperStart).toBeGreaterThan(-1);
    const bookingWrapperTagStart = html.lastIndexOf("<div", bookingWrapperStart);
    const bookingWrapperTag = html.slice(bookingWrapperTagStart, html.indexOf(">", bookingWrapperStart) + 1);
    expect(bookingWrapperTag).toContain("left:50%");
    expect(bookingWrapperTag).toContain("top:60%");
    // The island itself still hydrates from inside its positioned wrapper.
    const afterBookingWrapper = html.slice(bookingWrapperStart);
    expect(afterBookingWrapper).toMatch(/<astro-island[^>]*client="load"/);

    // ADR-0014 point 4: order is the z-stack order, higher paints on top.
    // The Hero (order 1000) ranks below the Booking widget (order 2000)
    // regardless of which one appears first in the document.
    expect(heroWrapperTag).toContain("z-index:1");
    expect(bookingWrapperTag).toContain("z-index:2");
  }, 60_000);

  it("a flow-layout page's published HTML carries no free-positioning markup at all", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-"));
    const { site, theme, pages } = freePageSite();
    const flowPages = pages.map((p) => ({
      ...p,
      layoutMode: "flow" as const,
      blocks: p.blocks.map(({ position: _position, ...rest }) => rest),
    }));

    const result = await buildSiteBundle({ site, theme, pages: flowPages, bundleStoreDir, runtimeApiUrl: "https://api.example.test" });
    const html = await readFile(path.join(result.bundlePath, "index.html"), "utf8");

    expect(html).not.toContain("data-pf-free-canvas-root");
    expect(html).not.toContain("data-pf-free-block-id");
    expect(html).not.toContain("position:absolute");
  }, 60_000);
});
