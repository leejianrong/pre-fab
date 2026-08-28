import { test, expect } from "@playwright/test";
import { authenticatedContext, canvasFrame, loginInBrowser, openSiteByName } from "./helpers.js";

// SLICES.md Slice 2: "Switching theme restyles every block with no
// document mutation." The restyling half is checked by reading the
// canvas iframe's own resolved CSS custom property; the "no document
// mutation" half is checked by re-fetching the page document over the API
// (the same one the canvas itself would have just saved from, had this
// been a block edit) and asserting the blocks are unchanged.
test("switching theme restyles the canvas with no page document mutation", async ({ page }) => {
  const { ctx, site } = await authenticatedContext("theme-switch");

  const before = await ctx.api.getPage(site.site.id, site.page.id);

  await loginInBrowser(page);
  await openSiteByName(page, site.site.name);

  const frame = canvasFrame(page);
  // The theme's CSS variables are set on Puck's own root wrapper div
  // (packages/puck-adapter/src/config.tsx, marked `data-pf-theme-root` for
  // exactly this kind of check) — not on <body>, since custom properties
  // only inherit to descendants, never back up to an ancestor.
  const themeRoot = frame.locator("[data-pf-theme-root]");
  await expect(themeRoot).toBeVisible({ timeout: 15_000 });

  const accentBefore = await themeRoot.evaluate((el) => getComputedStyle(el).getPropertyValue("--pf-color-accent").trim());

  await page.getByRole("button", { name: /^theme$/i }).click();
  const newAccent = "#ff00aa";
  const accentInput = page.locator('input[data-pf-token-input="color.accent"]');
  await accentInput.fill(newAccent);
  await page.getByRole("button", { name: /save theme/i }).click();
  await expect(page.getByRole("dialog", { name: /theme editor/i })).toHaveCount(0, { timeout: 10_000 });

  await expect(async () => {
    const accentAfter = await themeRoot.evaluate((el) => getComputedStyle(el).getPropertyValue("--pf-color-accent").trim());
    expect(accentAfter).toBe(newAccent);
  }).toPass({ timeout: 10_000 });

  const accentAfterFinal = await themeRoot.evaluate((el) => getComputedStyle(el).getPropertyValue("--pf-color-accent").trim());
  expect(accentAfterFinal).not.toBe(accentBefore);

  const after = await ctx.api.getPage(site.site.id, site.page.id);
  expect(after.version).toBe(before.version);
  expect(after.blocks).toEqual(before.blocks);
});
