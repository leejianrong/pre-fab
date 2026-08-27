import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newUlid, DEFAULT_THEME_TOKENS } from "@prefab/schema";
import { HERO_BLOCK_TYPE, heroDefaultProps } from "@prefab/blocks";
import { buildSiteBundle } from "../src/build.js";
import { servePreview } from "../src/preview-server.js";

let bundleStoreDir: string;
let closePreview: (() => Promise<void>) | undefined;

afterEach(async () => {
  await closePreview?.();
  closePreview = undefined;
  if (bundleStoreDir) await rm(bundleStoreDir, { recursive: true, force: true });
});

function testSite() {
  const siteId = newUlid();
  const pageId = newUlid();
  const blockId = newUlid();
  return {
    site: { id: siteId, slug: "demo", name: "Demo Site", ownerId: newUlid(), schemaVersion: 1, pages: [{ id: pageId, slug: "home" }] },
    theme: { id: newUlid(), siteId, schemaVersion: 1, tokens: DEFAULT_THEME_TOKENS },
    pages: [
      {
        id: pageId,
        siteId,
        slug: "home",
        title: "Home",
        schemaVersion: 1,
        version: 0,
        blocks: [
          {
            id: blockId,
            type: HERO_BLOCK_TYPE,
            parent: null,
            order: 1000,
            schemaVersion: 1,
            props: { ...heroDefaultProps, heading: "Publish pipeline works" },
          },
        ],
      },
    ],
  };
}

describe("buildSiteBundle", () => {
  it("renders the Hero block to static HTML with theme tokens resolved, and ships zero JS for it", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-"));
    const { site, theme, pages } = testSite();

    const result = await buildSiteBundle({ site, theme, pages, bundleStoreDir });

    const html = await readFile(path.join(result.bundlePath, "index.html"), "utf8");
    expect(html).toContain("Publish pipeline works");
    expect(html).toContain('data-pf-block-type="hero"');
    // The theme's own token *definitions* legitimately carry raw values —
    // that's the one place they're allowed to. What invariant 2 forbids is
    // the *block's* markup referencing anything but the token.
    const heroMarkup = html.slice(html.indexOf('class="pf-block pf-hero"'));
    expect(heroMarkup).toMatch(/var\(--pf-color-background\)/);
    expect(heroMarkup).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    // No client-side script for a fully static block (ADR-0007).
    expect(html).not.toMatch(/<script[^>]*type="module"/);

    const { url, close } = await servePreview(result.bundlePath);
    closePreview = close;
    const response = await fetch(url);
    expect(response.status).toBe(200);
    const servedHtml = await response.text();
    expect(servedHtml).toBe(html);
  }, 60_000);

  it("is content-addressed: building the same document twice reuses the same bundle path", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-"));
    const { site, theme, pages } = testSite();

    const first = await buildSiteBundle({ site, theme, pages, bundleStoreDir });
    const second = await buildSiteBundle({ site, theme, pages, bundleStoreDir });

    expect(second.contentHash).toBe(first.contentHash);
    expect(second.bundlePath).toBe(first.bundlePath);
  }, 60_000);

  it("skips a block of an unknown type on the published page without touching the rest (R19)", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-"));
    const { site, theme, pages } = testSite();
    pages[0]!.blocks.push({
      id: newUlid(),
      type: "vendor.widget",
      parent: null,
      order: 2000,
      schemaVersion: 1,
      props: { anything: true },
    });

    const result = await buildSiteBundle({ site, theme, pages, bundleStoreDir });
    const html = await readFile(path.join(result.bundlePath, "index.html"), "utf8");

    expect(html).toContain("Publish pipeline works");
    expect(html).not.toContain("vendor.widget");
  }, 60_000);
});
