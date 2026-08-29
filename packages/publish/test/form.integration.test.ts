import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newUlid, DEFAULT_THEME_TOKENS } from "@prefab/schema";
import { HERO_BLOCK_TYPE, heroDefaultProps, FORM_BLOCK_TYPE, formDefaultProps } from "@prefab/blocks";
import { buildSiteBundle } from "../src/build.js";

let bundleStoreDir: string;

afterEach(async () => {
  if (bundleStoreDir) await rm(bundleStoreDir, { recursive: true, force: true });
});

function testSite() {
  const siteId = newUlid();
  const pageId = newUlid();
  const heroBlockId = newUlid();
  const formBlockId = newUlid();
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
            id: heroBlockId,
            type: HERO_BLOCK_TYPE,
            parent: null,
            order: 1000,
            schemaVersion: 1,
            props: { ...heroDefaultProps, heading: "Static as ever" },
          },
          {
            id: formBlockId,
            type: FORM_BLOCK_TYPE,
            parent: null,
            order: 2000,
            schemaVersion: 1,
            props: formDefaultProps,
          },
        ],
      },
    ],
    formBlockId,
  };
}

describe("buildSiteBundle — Form block hydration (Slice 6, ADR-0007)", () => {
  it("ships React hydration JS for the Form block, unlike every other static block on the same page", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-"));
    const { site, theme, pages } = testSite();

    const result = await buildSiteBundle({ site, theme, pages, bundleStoreDir, runtimeApiUrl: "https://api.example.test" });
    const html = await readFile(path.join(result.bundlePath, "index.html"), "utf8");

    expect(html).toContain("Static as ever");
    expect(html).toContain('data-pf-block-type="form"');
    // Hydration is what turns the client:load directive into real output:
    // Astro wraps a hydrated component in an <astro-island> custom element
    // referencing a real component-url chunk to load client-side — absent
    // from a Hero-only build (build.integration.test.ts's own assertion
    // for the same file, which checks for no module script at all).
    expect(html).toMatch(/<astro-island[^>]*client="load"/);
    expect(html).toMatch(/component-url="[^"]+\.js"/);
    // Hero, right next to it on the same page, still ships nothing.
    const heroMarkup = html.slice(html.indexOf('class="pf-block pf-hero"'), html.indexOf("</section>"));
    expect(heroMarkup).not.toContain("astro-island");
  }, 60_000);

  it("passes the configured runtimeApiUrl through to the built page for the submit island to read", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-"));
    const { site, theme, pages } = testSite();

    const result = await buildSiteBundle({ site, theme, pages, bundleStoreDir, runtimeApiUrl: "https://api.example.test" });
    const html = await readFile(path.join(result.bundlePath, "index.html"), "utf8");

    // Astro serializes a hydrated island's props (including runtimeApiUrl)
    // into the page so the client can rehydrate with the same values.
    expect(html).toContain("api.example.test");
  }, 60_000);

  // Slice 7 (ADR-0010, R20): every bundle carries the publish-safe form
  // manifest the self-host runtime needs to seed its own forms store, and
  // nothing else — no notifyEmail/webhookUrl/webhookSecret, which never
  // exist in a page document in the first place.
  it("writes prefab-forms.json with every Form block's publish-safe manifest, and nothing else", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-"));
    const { site, theme, pages, formBlockId } = testSite();

    const result = await buildSiteBundle({ site, theme, pages, bundleStoreDir, runtimeApiUrl: "https://api.example.test" });
    const formsJson = JSON.parse(await readFile(path.join(result.bundlePath, "prefab-forms.json"), "utf8"));

    expect(formsJson).toEqual([
      {
        id: formBlockId,
        siteId: site.id,
        heading: formDefaultProps.heading,
        fields: formDefaultProps.fields,
        submitLabel: formDefaultProps.submitLabel,
        turnstileEnabled: formDefaultProps.turnstileEnabled,
      },
    ]);
  }, 60_000);
});
