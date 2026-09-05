import type { BlockNode } from "@prefab/schema";

/**
 * ADR-0015 (KAN-1152): a scroll-triggered reveal animation, opt-in per
 * block via `BlockRenderProps.scrollReveal` (responsive.tsx). Deliberately
 * NOT shaped like `ResponsiveStyle`/`FreePositionStyle` (a per-block
 * `<style>` scoped to `data-pf-block-id`) — there is nothing block-specific
 * to compute here (every reveal looks the same: fade + slight upward
 * translate), so the selector is one shared global attribute
 * (`data-pf-reveal`), and the CSS/script pair below is rendered exactly
 * once per page (`ScrollRevealAssets`, called by @prefab/publish's
 * page-template.ts), not once per block.
 *
 * No block component needs a `useEffect` for this at all: the only
 * client-side code is `SCROLL_REVEAL_BOOTSTRAP_SCRIPT`, a plain string
 * emitted as a literal `<script>` tag by the Astro page template. It never
 * runs during SSR (the Astro/Node build treats it as opaque text; only a
 * browser ever executes it), so it sits entirely outside
 * tools/checks/src/ssr-safety.ts's remit — that checker AST-scans block
 * *component* source for a bare browser-global identifier, and explicitly
 * treats a string literal mentioning "window" as not a violation. See
 * ADR-0015 for the full design, including why this could not be a
 * per-block React island instead (Astro's client:* directives need a
 * statically-known import per rendered tag).
 */

/** The one attribute the whole mechanism keys off — deliberately not `data-pf-block-id` (that's `ResponsiveStyle`/fidelity's own selector, kept independent so this feature's presence/absence never depends on a block having an id). */
export const SCROLL_REVEAL_ATTR = "data-pf-reveal";

/**
 * A block spreads this onto its own root element alongside its existing
 * `data-pf-block-id`/`data-pf-block-type` attributes. Returns `{}` (no
 * attribute at all) when not enabled, so an unrevealed block's markup is
 * completely unchanged — matching `ResponsiveStyle`'s "renders nothing when
 * there's nothing to override."
 */
export function scrollRevealAttrs(enabled?: boolean): Record<string, string> {
  return enabled ? { [SCROLL_REVEAL_ATTR]: "" } : {};
}

/**
 * Whether a page needs `ScrollRevealAssets` rendered at all — `false` (the
 * common case: every existing document, since `scrollReveal` defaults to
 * `false` on every block) means zero extra CSS/JS bytes ship on that page.
 * Pure and block-shape-agnostic (only reads `scrollReveal`), so it works
 * the same whether given full `BlockNode`s or the minimal shape a caller
 * happens to have on hand.
 */
export function pageNeedsScrollRevealAssets(blocks: readonly Pick<BlockNode, "scrollReveal">[]): boolean {
  return blocks.some((b) => b.scrollReveal === true);
}

/**
 * The script's own first decision, pulled out as a real, independently
 * unit-testable function rather than left only inside the opaque script
 * string below (which is not itself unit-testable — it never runs under
 * Node). Kept in sync with `SCROLL_REVEAL_BOOTSTRAP_SCRIPT` by hand, the
 * same duplication trade-off `free-position.tsx`'s
 * `FREE_CANVAS_BASE_HEIGHT_PX` documents for the same reason: the two
 * live in genuinely different execution contexts (this runs under Vitest;
 * the script text only ever runs in a browser).
 */
export function initialRevealClassName(prefersReducedMotion: boolean): "" | "pf-reveal-hidden" {
  return prefersReducedMotion ? "" : "pf-reveal-hidden";
}

/**
 * Base state: fully visible, no transform — true for every `[data-pf-
 * reveal]` element until the bootstrap script explicitly adds
 * `pf-reveal-hidden`, which only ever happens in a browser, only when
 * `IntersectionObserver` exists, and only when reduced motion is not
 * requested. A no-JS visitor, a crawler, and the pixel-fidelity harness
 * (tools/checks/src/fidelity.ts) therefore always see the real content —
 * this rule is what makes that true, not a hope about script timing.
 *
 * The `prefers-reduced-motion` media query is an unconditional CSS
 * override, redundant with the script's own check by design: even if the
 * script's `matchMedia` check were ever wrong, this still wins, because it
 * is plain CSS the browser evaluates regardless of any class the script
 * has added.
 */
export const SCROLL_REVEAL_STYLE_CSS = `[${SCROLL_REVEAL_ATTR}]{opacity:1;transform:none;transition:opacity .6s ease-out,transform .6s ease-out}
[${SCROLL_REVEAL_ATTR}].pf-reveal-hidden{opacity:0;transform:translateY(16px)}
@media (prefers-reduced-motion: reduce){
[${SCROLL_REVEAL_ATTR}]{transition:none!important}
[${SCROLL_REVEAL_ATTR}].pf-reveal-hidden{opacity:1!important;transform:none!important}
}`;

/**
 * Vanilla JS, not React: one observer shared by every `[data-pf-reveal]`
 * element on the page, regardless of how many blocks opted in or what
 * block type they are. Mirrors `initialRevealClassName` above by hand.
 *
 * Order of operations, each a deliberate safety property from ADR-0015:
 * 1. Reduced motion first, before anything else touches the DOM — if
 *    requested, return immediately. No element is ever hidden, no
 *    observer is ever created, so there is no delay and no partial
 *    transparency for that visitor, full stop.
 * 2. Feature-detect `IntersectionObserver` — an old/no-JS-API browser
 *    leaves every element in its default (fully visible) CSS state rather
 *    than throwing or hiding content it can never reveal.
 * 3. Deferred to `DOMContentLoaded` (or run immediately if the document is
 *    already past `"loading"`): `ScrollRevealAssets` is rendered near the
 *    top of `<body>`, before any block markup, precisely so a page with
 *    nothing opted in stays a one-line no-op check — but that means this
 *    script's own tag is parsed and executed *before* the block elements
 *    it needs to find exist in the DOM yet. Without this, `querySelectorAll`
 *    would always return an empty list. Waiting for `DOMContentLoaded`
 *    (rather than depending on script placement) also makes this correct
 *    regardless of where a future caller ever places the tag.
 * 4. Only once all of the above pass does any element gain
 *    `pf-reveal-hidden`, and only elements not already inside the viewport
 *    at that moment (`getBoundingClientRect` before observing) — content
 *    already on screen at load is never hidden-then-revealed.
 */
export const SCROLL_REVEAL_BOOTSTRAP_SCRIPT = `(function(){
if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
if (!("IntersectionObserver" in window)) return;
function run(){
  var els = document.querySelectorAll("[${SCROLL_REVEAL_ATTR}]");
  var vh = window.innerHeight || document.documentElement.clientHeight;
  var observer = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if (entry.isIntersecting) {
        entry.target.classList.remove("pf-reveal-hidden");
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: "0px 0px -10% 0px" });
  els.forEach(function(el){
    var rect = el.getBoundingClientRect();
    if (rect.top < vh && rect.bottom > 0) return;
    el.classList.add("pf-reveal-hidden");
    observer.observe(el);
  });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", run);
} else {
  run();
}
})();`;

/**
 * Rendered exactly once per page by @prefab/publish's page-template.ts,
 * gated on `pageNeedsScrollRevealAssets` — a page with nothing opted in
 * renders nothing, the same "nothing to do" shape `ResponsiveStyle`/
 * `FreePositionStyle` already follow.
 */
export function ScrollRevealAssets({ anyRevealed }: { anyRevealed: boolean }) {
  if (!anyRevealed) return null;
  return (
    <>
      <style>{SCROLL_REVEAL_STYLE_CSS}</style>
      <script>{SCROLL_REVEAL_BOOTSTRAP_SCRIPT}</script>
    </>
  );
}
