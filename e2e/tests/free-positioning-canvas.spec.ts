import { test, expect } from "@playwright/test";
import { authenticatedContext, loginInBrowser, openSiteByName } from "./helpers.js";

/**
 * ADR-0014 / KAN-1129: the canvas (Puck adapter) half of free positioning.
 * Repositions a block through the free-canvas overlay's accessible x/y
 * toolbar rather than simulating a raw mouse drag — Playwright can drive a
 * real pointer drag, but the numeric fields are the deliberately-provided
 * accessible/keyboard-operable alternative (see free-canvas.tsx's
 * FreeCanvasToolbar), give the exact same write path (onRectChange ->
 * SiteEditor's `positions` state -> handleSave's applyFreePositions), and
 * make the assertion about *what value got saved* exact rather than
 * "moved by roughly this many pixels."
 *
 * Unlike theme-switch.spec.ts and friends, this doesn't go through
 * `canvasFrame()` (Puck's default iframe-wrapped preview) — free-canvas.tsx's
 * FreeCanvasPreview replaces Puck's own preview (`Preview2`) entirely while
 * `layoutMode === "free"`, and that component is also what sets up Puck's
 * iframe, so the free-canvas overlay renders directly in the top-level
 * document instead. See this slice's PR body for the FRICTION note on that.
 */
test("switching a page to free layout, repositioning a block via the accessible x/y controls, and saving persists the position", async ({
  page,
}) => {
  const { ctx, site } = await authenticatedContext("free-canvas");

  await loginInBrowser(page);
  await openSiteByName(page, site.site.name);

  // 1. Switch the page to "free" layout — local UI state only so far,
  // nothing written yet.
  await page.getByLabel(/^layout$/i).selectOption("free");

  const canvas = page.locator("[data-pf-free-canvas]");
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // The page's one seeded block (a Hero) must already show a default rect —
  // switching flow -> free assigns one immediately, before any save.
  const block = page.locator("[data-pf-free-block]").first();
  await expect(block).toBeVisible();
  const defaultLeft = await block.evaluate((el) => (el as HTMLElement).style.left);
  expect(defaultLeft).toMatch(/%$/);

  // 2. Select it (a click with no drag) to reveal the accessible toolbar,
  // then set an exact x/y through it.
  await block.click();
  const xField = page.locator('[data-pf-free-field="x"]');
  const yField = page.locator('[data-pf-free-field="y"]');
  await expect(xField).toBeVisible({ timeout: 5_000 });
  await xField.fill("12");
  await yField.fill("34");

  // 3. Save, then reload the whole editor from a clean slate.
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByText(/^saved$/i)).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await openSiteByName(page, site.site.name);
  await expect(page.getByLabel(/^layout$/i)).toHaveValue("free");

  const blockAfterReload = page.locator("[data-pf-free-block]").first();
  await expect(blockAfterReload).toBeVisible({ timeout: 15_000 });
  const leftAfterReload = await blockAfterReload.evaluate((el) => (el as HTMLElement).style.left);
  const topAfterReload = await blockAfterReload.evaluate((el) => (el as HTMLElement).style.top);
  expect(leftAfterReload).toBe("12%");
  expect(topAfterReload).toBe("34%");

  // Cross-check against the document apps/api actually stored — the same
  // ground truth the CLI/MCP surfaces would read (R12 parity).
  const saved = await ctx.api.getPage(site.site.id, site.page.id);
  expect(saved.layoutMode).toBe("free");
  const rootBlock = saved.blocks.find((b) => b.parent === null);
  expect(rootBlock?.position?.base.x).toBe(12);
  expect(rootBlock?.position?.base.y).toBe(34);
});

test("switching a free page back to flow strips every block's position on save", async ({ page }) => {
  const { ctx, site } = await authenticatedContext("free-canvas-revert");

  // Seed the page as already "free" with a positioned root block, so this
  // test exercises the free -> flow direction independently of the other
  // test's flow -> free toggle.
  const heroBlock = site.page.blocks[0]!;
  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [{ ...heroBlock, position: { base: { x: 10, y: 10, w: 50, h: 20, rotate: 0, opacity: 1 } } }],
    layoutMode: "free",
    expectedVersion: site.page.version,
  });

  await loginInBrowser(page);
  await openSiteByName(page, site.site.name);
  await expect(page.getByLabel(/^layout$/i)).toHaveValue("free");
  await expect(page.locator("[data-pf-free-canvas]")).toBeVisible({ timeout: 15_000 });

  await page.getByLabel(/^layout$/i).selectOption("flow");
  // Puck's normal list preview is back — the free-canvas overlay is gone.
  await expect(page.locator("[data-pf-free-canvas]")).toHaveCount(0);

  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByText(/^saved$/i)).toBeVisible({ timeout: 10_000 });

  const saved = await ctx.api.getPage(site.site.id, site.page.id);
  expect(saved.layoutMode).toBe("flow");
  for (const b of saved.blocks) {
    expect(b.position).toBeUndefined();
  }
});
