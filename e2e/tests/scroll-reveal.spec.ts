import { test, expect } from "@playwright/test";
import { newUlid } from "@prefab/schema";
import { API_URL, authenticatedContext, gotoLiveSite } from "./helpers.js";

/**
 * ADR-0015 (KAN-1152): the scroll-triggered reveal render path. Three
 * properties, matched one-to-one to the card's own test requirements:
 *
 * (a) motion allowed + JS enabled: an opted-in block starts below the fold,
 *     is hidden once the bootstrap script runs, and visibly reveals once
 *     scrolled into view.
 * (b) `prefers-reduced-motion: reduce` emulated: the same block is fully
 *     visible immediately, with no hidden state and no animation, even
 *     without ever scrolling it into view.
 * (c) the block's real content is present in the raw server-rendered HTML
 *     regardless of any of the above — fetched directly (no browser, no JS
 *     execution at all), the way unknown-block.spec.ts proves R19's
 *     "never silently dropped" the same way.
 *
 * A dozen spacer blocks push the reveal-enabled Hero comfortably below a
 * small viewport's fold, so "not intersecting at load" is real geometry,
 * not assumed.
 */
function spacerBlock(id: string, order: number) {
  return {
    id,
    type: "spacer",
    parent: null,
    order,
    schemaVersion: 1,
    props: { height: "section" },
    responsive: {},
  };
}

function revealedHeroBlock(id: string, order: number) {
  return {
    id,
    type: "hero",
    parent: null,
    order,
    schemaVersion: 1,
    props: {
      heading: "Reveals on scroll",
      subheading: "",
      ctaLabel: "",
      ctaHref: "",
      background: "background",
      backgroundImage: "",
    },
    responsive: {},
    scrollReveal: true,
  };
}

test.describe("scroll-triggered reveal (ADR-0015, KAN-1152)", () => {
  test("an opted-in block is hidden below the fold, then reveals as it scrolls into view", async ({ page }) => {
    const { ctx, site } = await authenticatedContext("scroll-reveal");
    const heroId = newUlid();
    const spacerIds = Array.from({ length: 12 }, () => newUlid());

    await ctx.api.writePage(site.site.id, site.page.id, {
      title: site.page.title,
      slug: site.page.slug,
      blocks: [...spacerIds.map((id, i) => spacerBlock(id, (i + 1) * 100)), revealedHeroBlock(heroId, 1000)],
      expectedVersion: site.page.version,
    });
    await ctx.api.publish(site.site.id);

    await page.setViewportSize({ width: 800, height: 400 });
    await gotoLiveSite(page, `${site.site.slug}.prefab.local`);

    const hero = page.locator('[data-pf-reveal][data-pf-block-id="' + heroId + '"]');
    await expect(hero).toHaveCount(1);

    // Below the fold at load (12 * 64px of spacer, comfortably clear of
    // the 400px viewport), so the bootstrap script should have hidden it
    // shortly after running.
    await expect(hero).toHaveClass(/pf-reveal-hidden/);
    await expect(hero).toHaveCSS("opacity", "0");

    await hero.scrollIntoViewIfNeeded();

    // The IntersectionObserver callback removes the class once intersecting;
    // the CSS transition then animates opacity back to 1.
    await expect(hero).not.toHaveClass(/pf-reveal-hidden/);
    await expect(hero).toHaveCSS("opacity", "1");
  });

  test("prefers-reduced-motion: the same block is fully visible immediately, never hidden", async ({ page }) => {
    const { ctx, site } = await authenticatedContext("scroll-reveal-reduced-motion");
    const heroId = newUlid();
    const spacerIds = Array.from({ length: 12 }, () => newUlid());

    await ctx.api.writePage(site.site.id, site.page.id, {
      title: site.page.title,
      slug: site.page.slug,
      blocks: [...spacerIds.map((id, i) => spacerBlock(id, (i + 1) * 100)), revealedHeroBlock(heroId, 1000)],
      expectedVersion: site.page.version,
    });
    await ctx.api.publish(site.site.id);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 800, height: 400 });
    await gotoLiveSite(page, `${site.site.slug}.prefab.local`);

    const hero = page.locator('[data-pf-reveal][data-pf-block-id="' + heroId + '"]');
    await expect(hero).toHaveCount(1);

    // Still below the fold (no scrolling happened), but never hidden and
    // never mid-transition: the bootstrap script's own reduced-motion check
    // short-circuits before it ever touches this element, and the CSS
    // media-query override would force this even if it hadn't.
    await expect(hero).not.toHaveClass(/pf-reveal-hidden/);
    await expect(hero).toHaveCSS("opacity", "1");
    await expect(hero).toHaveCSS("transition-duration", "0s");
  });

  test("the block's real content is present in the raw published HTML, with no JS involved", async () => {
    const { ctx, site } = await authenticatedContext("scroll-reveal-raw-html");
    const heroId = newUlid();

    await ctx.api.writePage(site.site.id, site.page.id, {
      title: site.page.title,
      slug: site.page.slug,
      blocks: [revealedHeroBlock(heroId, 1000)],
      expectedVersion: site.page.version,
    });
    const published = await ctx.api.publish(site.site.id);

    const liveHtml = await (await fetch(`${API_URL}/v1/bundles/${published.publish.contentHash}/index.html`)).text();

    // Real content, present unconditionally — not gated on JS ever running.
    expect(liveHtml).toContain("Reveals on scroll");
    expect(liveHtml).toContain(`data-pf-reveal`);
    expect(liveHtml).toContain(`data-pf-block-id="${heroId}"`);
    // No inline hidden styling, and no element actually carries the
    // hidden class, baked into the server-rendered markup — the hidden
    // state only ever exists as a class the client-side script adds after
    // the fact. (The shared CSS/script text legitimately mentions the
    // string "pf-reveal-hidden" as a selector/class-name literal — this
    // checks no *element's* `class` attribute contains it, not mere
    // absence of the substring anywhere in the page.)
    expect(liveHtml).not.toMatch(/data-pf-block-id="[^"]*"[^>]*style="[^"]*opacity:\s*0/);
    expect(liveHtml).not.toMatch(/class="[^"]*pf-reveal-hidden[^"]*"/);
  });
});
