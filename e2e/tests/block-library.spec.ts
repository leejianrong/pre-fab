import { test, expect } from "@playwright/test";
import { API_URL, ALL_BLOCK_TYPES, allBlockTypesBlocks, authenticatedContext } from "./helpers.js";

// SLICES.md Slice 2: "A page assembled from every block type publishes and
// renders correctly at all three breakpoints." Bundle serving
// (/v1/bundles/:hash/*) is unauthenticated (apps/api/src/app.ts) — the
// same route a real *.prefab.app hostname would resolve to — so this
// navigates a real browser there directly, at three real viewport widths,
// rather than only fetching the HTML string.
test("a page of every block type publishes and renders correctly at all three breakpoints", async ({ page }) => {
  const { ctx, site } = await authenticatedContext("block-library");

  const blocks = allBlockTypesBlocks();
  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks,
    expectedVersion: site.page.version,
  });

  const published = await ctx.api.publish(site.site.id);
  const bundleUrl = `${API_URL}/v1/bundles/${published.publish.contentHash}/index.html`;

  const viewports = [
    { name: "mobile", width: 375, height: 800 },
    { name: "tablet", width: 800, height: 900 },
    { name: "desktop", width: 1400, height: 1000 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(bundleUrl);

    for (const type of ALL_BLOCK_TYPES) {
      const el = page.locator(`[data-pf-block-type="${type}"]`);
      await expect(el, `block type "${type}" at ${viewport.name} (${viewport.width}px)`).toBeVisible();
    }

    // No page-level error output (React never mounts here — this is pure
    // static Astro output, ADR-0007 — so a rendering crash would show as
    // literally missing markup rather than a React error boundary).
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length, `non-empty body at ${viewport.name}`).toBeGreaterThan(0);
  }
});
