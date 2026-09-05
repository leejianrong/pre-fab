import { test, expect } from "@playwright/test";
import { newUlid } from "@prefab/schema";
import { authenticatedContext, gotoLiveSite } from "./helpers.js";

/**
 * ADR-0014 / KAN-1129, parts 1-3's missing piece: the actual render path a
 * visitor sees. Parts 2 (schema) and 3 (Puck-adapter canvas,
 * free-positioning-canvas.spec.ts) prove `position` is editable and
 * persists; this proves it's not just data — a published `"free"` page
 * really does render its root blocks at the authored x/y/w/h/rotate/opacity,
 * on the real served page, not the editor. Reads `getComputedStyle` on the
 * live site the way theme-switch.spec.ts reads a resolved CSS custom
 * property, rather than a pixel screenshot — exact numbers, not "moved by
 * roughly this many pixels."
 */
function heroBlock(id: string) {
  return {
    id,
    type: "hero",
    parent: null,
    order: 1000,
    schemaVersion: 1,
    props: { heading: "Free-positioned hero", subheading: "", ctaLabel: "", ctaHref: "", background: "background", backgroundImage: "" },
    responsive: {},
    position: {
      base: { x: 10, y: 20, w: 30, h: 40, rotate: -15, opacity: 0.9 },
      md: { x: 40 },
      lg: { x: 70, y: 60 },
    },
  };
}

function bookingBlock(id: string) {
  return {
    id,
    type: "booking",
    parent: null,
    // A lower `order` than the hero above, so ADR-0014 point 4 ("higher
    // `order` paints on top") means this block must rank *below* it in
    // z-index despite being the second block in document order.
    order: 500,
    schemaVersion: 1,
    props: { heading: "Book a time", description: "Pick a slot", confirmLabel: "Confirm booking", successMessage: "Booked!" },
    responsive: {},
    position: { base: { x: 50, y: 60, w: 20, h: 15, rotate: 0, opacity: 1 } },
  };
}

test.describe("free-positioning render path (ADR-0014, KAN-1129)", () => {
  test("a published free-layout page renders its root blocks absolutely positioned at their authored rects", async ({ page }) => {
    const { ctx, site } = await authenticatedContext("free-render");
    const heroId = newUlid();
    const bookingId = newUlid();

    await ctx.api.writePage(site.site.id, site.page.id, {
      title: site.page.title,
      slug: site.page.slug,
      layoutMode: "free",
      blocks: [heroBlock(heroId), bookingBlock(bookingId)],
      expectedVersion: site.page.version,
    });
    await ctx.api.publish(site.site.id);

    await page.setViewportSize({ width: 500, height: 900 });
    await gotoLiveSite(page, `${site.site.slug}.prefab.local`);

    const canvasRoot = page.locator("[data-pf-free-canvas-root]");
    await expect(canvasRoot).toBeVisible();

    const heroWrapper = page.locator(`[data-pf-free-block-id="${heroId}"]`);
    const bookingWrapper = page.locator(`[data-pf-free-block-id="${bookingId}"]`);
    await expect(heroWrapper).toBeVisible();
    await expect(bookingWrapper).toBeVisible();

    // Below the md breakpoint (640px): the hero's base rect applies as
    // authored, with no override in effect.
    const heroBelowMd = await heroWrapper.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { position: cs.position, left: cs.left, top: cs.top, width: cs.width, transform: cs.transform, opacity: cs.opacity };
    });
    expect(heroBelowMd.position).toBe("absolute");
    const canvasBox = await canvasRoot.boundingBox();
    expect(canvasBox).not.toBeNull();
    const expectedLeftPx = 0.1 * canvasBox!.width;
    expect(parseFloat(heroBelowMd.left)).toBeCloseTo(expectedLeftPx, 0);
    expect(parseFloat(heroBelowMd.width)).toBeCloseTo(0.3 * canvasBox!.width, 0);
    expect(heroBelowMd.opacity).toBe("0.9");
    // A -15deg rotation renders as a 2D matrix; asserting the transform is
    // non-trivial (not "none") is what distinguishes "rotation applied" from
    // "rotation ignored" without hand-deriving the exact matrix.
    expect(heroBelowMd.transform).not.toBe("none");

    // ADR-0014 point 4: order is the z-stack order, higher paints on top.
    // The hero (order 1000) must rank above the booking widget (order 500)
    // even though the booking block was written second.
    const [heroZ, bookingZ] = await Promise.all([
      heroWrapper.evaluate((el) => Number(getComputedStyle(el).zIndex)),
      bookingWrapper.evaluate((el) => Number(getComputedStyle(el).zIndex)),
    ]);
    expect(heroZ).toBeGreaterThan(bookingZ);

    // The Booking block is a client:load island (ADR-0007) — positioning
    // must compose with hydration, not replace it (KAN-1129 scope item 4).
    await expect(page.getByText("Book a time")).toBeVisible();

    // md breakpoint (>=640px): the hero's md override (x only) takes over;
    // y/w/h fall back to base since md never named them.
    await page.setViewportSize({ width: 800, height: 900 });
    const canvasBoxMd = await canvasRoot.boundingBox();
    const heroAtMd = await heroWrapper.evaluate((el) => getComputedStyle(el).left);
    expect(parseFloat(heroAtMd)).toBeCloseTo(0.4 * canvasBoxMd!.width, 0);

    // lg breakpoint (>=1024px): lg's own x and y both take over.
    await page.setViewportSize({ width: 1200, height: 900 });
    const canvasBoxLg = await canvasRoot.boundingBox();
    const heroAtLg = await heroWrapper.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { left: cs.left, top: cs.top };
    });
    expect(parseFloat(heroAtLg.left)).toBeCloseTo(0.7 * canvasBoxLg!.width, 0);
    // top is a percentage of the canvas's own (fixed-baseline) height, not
    // its width — see freeCanvasRootStyle's own comment for why that
    // baseline has to be a definite height at all.
    expect(parseFloat(heroAtLg.top)).toBeCloseTo(0.6 * canvasBoxLg!.height, 0);
  });

  test("a published flow-layout page renders no free-positioning markup at all", async ({ page }) => {
    const { site } = await authenticatedContext("free-render-flow-control");

    // The seeded page is already "flow" (the default) with its seeded Hero
    // block — untouched, so this is the plainest possible negative control
    // for byte-identical flow output.
    await gotoLiveSite(page, `${site.site.slug}.prefab.local`);

    await expect(page.locator("[data-pf-free-canvas-root]")).toHaveCount(0);
    await expect(page.locator("[data-pf-free-block-id]")).toHaveCount(0);
  });
});
