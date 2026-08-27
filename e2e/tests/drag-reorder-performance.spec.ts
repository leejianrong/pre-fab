import { test, expect } from "@playwright/test";
import { authenticatedContext, canvasFrame, loginInBrowser, manyMixedBlocks, openSiteByName } from "./helpers.js";

function p95(durationsMs: number[]): number {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index]!;
}

/**
 * Polls the canvas iframe's root entry element for Puck's own
 * `data-puck-dragging` attribute (set the instant dnd-kit registers an
 * active drag — confirmed against a live canvas: absent before a drag,
 * present the moment a pointer-down + move crosses dnd-kit's activation
 * distance) rather than guessing a fixed wait, since the requirement is
 * about *when* feedback appears, not whether it eventually does.
 */
async function waitForDraggingAttribute(page: import("@playwright/test").Page, timeoutMs: number): Promise<number> {
  const startedAt = performance.now();
  // A zero-delay poll loop floods the CDP channel with round-trips fast
  // enough to starve the very mouse-move event it's waiting to see take
  // effect (confirmed against a live canvas: a tight loop reliably missed
  // feedback that a 10ms-spaced poll reliably caught within single-digit
  // milliseconds) — so this paces itself deliberately rather than polling
  // as fast as possible.
  while (performance.now() - startedAt < timeoutMs) {
    const dragging = await page.evaluate(() => {
      const iframe = document.querySelector("iframe");
      const doc = iframe?.contentDocument;
      const el = doc?.querySelector("[data-puck-entry]");
      return el ? el.hasAttribute("data-puck-dragging") : false;
    });
    if (dragging) return performance.now() - startedAt;
    await page.waitForTimeout(10);
  }
  throw new Error(`data-puck-dragging never appeared within ${timeoutMs}ms`);
}

// SLICES.md Slice 2: "On a page of 40 mixed blocks, drag and reorder give
// visual feedback within 100 ms p95 (R2). Measured here rather than in
// slice 1 because a one-block page cannot fail this."
test("on a page of 40 mixed blocks, dragging gives visual feedback within 100ms p95", async ({ page }) => {
  const { ctx, site } = await authenticatedContext("drag-perf");

  const blocks = manyMixedBlocks(40);
  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks,
    expectedVersion: site.page.version,
  });

  await loginInBrowser(page);
  await openSiteByName(page, site.site.name);

  const frame = canvasFrame(page);
  const components = frame.locator("[data-puck-component]");
  await components.first().waitFor({ timeout: 15_000 });
  expect(await components.count()).toBe(40);

  const SAMPLES = 8;
  const durations: number[] = [];

  for (let i = 0; i < SAMPLES; i++) {
    // Cycling through the first 10 rather than reusing one index means
    // each sample drags a genuinely different (real, on-DOM) block — the
    // 300ms settle below is what keeps consecutive samples from picking
    // up dnd-kit's still-tearing-down drag-overlay clone instead.
    const target = components.nth(i % 10);
    const box = await target.boundingBox();
    if (!box) throw new Error("draggable component has no bounding box");

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + 25, { steps: 3 });

    const elapsedMs = await waitForDraggingAttribute(page, 1000);
    durations.push(elapsedMs);

    await page.mouse.up();
    // dnd-kit renders a floating drag-overlay clone of the active
    // draggable while a drag is in progress; it needs a moment to tear
    // down after drop (confirmed empirically: 100ms left it in the DOM
    // often enough to shift `[data-puck-component]` indices for the next
    // sample, 300ms reliably didn't) — too short a wait here doesn't fail
    // the requirement, it corrupts the *next* sample's target element.
    await page.waitForTimeout(300);
  }

  const p95Ms = p95(durations);
  expect(p95Ms, `drag-feedback latencies (ms): ${durations.map((d) => d.toFixed(1)).join(", ")}`).toBeLessThan(100);
});
