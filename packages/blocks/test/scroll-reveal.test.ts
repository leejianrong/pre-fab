import { describe, expect, it } from "vitest";
import {
  SCROLL_REVEAL_ATTR,
  SCROLL_REVEAL_BOOTSTRAP_SCRIPT,
  SCROLL_REVEAL_STYLE_CSS,
  initialRevealClassName,
  pageNeedsScrollRevealAssets,
  scrollRevealAttrs,
} from "../src/scroll-reveal.js";

describe("scrollRevealAttrs", () => {
  it("returns no attributes when not enabled", () => {
    expect(scrollRevealAttrs(false)).toEqual({});
    expect(scrollRevealAttrs(undefined)).toEqual({});
  });

  it("returns exactly the one reveal data attribute when enabled", () => {
    expect(scrollRevealAttrs(true)).toEqual({ [SCROLL_REVEAL_ATTR]: "" });
  });
});

describe("pageNeedsScrollRevealAssets", () => {
  it("is false for an empty block list", () => {
    expect(pageNeedsScrollRevealAssets([])).toBe(false);
  });

  it("is false when every block has scrollReveal false (every existing document)", () => {
    expect(pageNeedsScrollRevealAssets([{ scrollReveal: false }, { scrollReveal: false }])).toBe(false);
  });

  it("is true as soon as one block opts in, regardless of position in the list", () => {
    expect(pageNeedsScrollRevealAssets([{ scrollReveal: false }, { scrollReveal: true }])).toBe(true);
  });
});

describe("initialRevealClassName", () => {
  it("never hides content when reduced motion is requested", () => {
    expect(initialRevealClassName(true)).toBe("");
  });

  it("applies the hidden class before observing when motion is allowed", () => {
    expect(initialRevealClassName(false)).toBe("pf-reveal-hidden");
  });
});

describe("SCROLL_REVEAL_STYLE_CSS", () => {
  it("keeps the base attribute selector fully visible with no hidden class", () => {
    // The base rule (no `.pf-reveal-hidden`) must not itself set opacity:0 —
    // that's the "never permanently hidden without JS" property. It should
    // set opacity:1 unconditionally.
    expect(SCROLL_REVEAL_STYLE_CSS).toContain(`[${SCROLL_REVEAL_ATTR}]{opacity:1`);
  });

  it("only hides content once the script-added class is present", () => {
    expect(SCROLL_REVEAL_STYLE_CSS).toContain(`[${SCROLL_REVEAL_ATTR}].pf-reveal-hidden{opacity:0`);
  });

  it("forces immediate, transition-less visibility under prefers-reduced-motion", () => {
    expect(SCROLL_REVEAL_STYLE_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    const reducedMotionBlock = SCROLL_REVEAL_STYLE_CSS.slice(SCROLL_REVEAL_STYLE_CSS.indexOf("@media"));
    expect(reducedMotionBlock).toContain("opacity:1!important");
    expect(reducedMotionBlock).toContain("transform:none!important");
    expect(reducedMotionBlock).toContain("transition:none!important");
  });
});

describe("SCROLL_REVEAL_BOOTSTRAP_SCRIPT", () => {
  it("checks prefers-reduced-motion first and returns before touching any element", () => {
    const reducedMotionCheckIndex = SCROLL_REVEAL_BOOTSTRAP_SCRIPT.indexOf("prefers-reduced-motion");
    const querySelectorIndex = SCROLL_REVEAL_BOOTSTRAP_SCRIPT.indexOf("querySelectorAll");
    expect(reducedMotionCheckIndex).toBeGreaterThan(-1);
    expect(querySelectorIndex).toBeGreaterThan(-1);
    expect(reducedMotionCheckIndex).toBeLessThan(querySelectorIndex);
  });

  it("feature-detects IntersectionObserver before doing anything else", () => {
    const featureDetectIndex = SCROLL_REVEAL_BOOTSTRAP_SCRIPT.indexOf('"IntersectionObserver" in window');
    const querySelectorIndex = SCROLL_REVEAL_BOOTSTRAP_SCRIPT.indexOf("querySelectorAll");
    expect(featureDetectIndex).toBeGreaterThan(-1);
    expect(featureDetectIndex).toBeLessThan(querySelectorIndex);
  });

  it("keys off the shared reveal attribute, not a per-block id", () => {
    expect(SCROLL_REVEAL_BOOTSTRAP_SCRIPT).toContain(`[${SCROLL_REVEAL_ATTR}]`);
    expect(SCROLL_REVEAL_BOOTSTRAP_SCRIPT).not.toContain("data-pf-block-id");
  });

  // Found by the e2e spec, not by inspection: `ScrollRevealAssets` renders
  // near the top of <body>, before any block markup (so a page with
  // nothing opted in stays a one-line no-op), which means this script's
  // own tag is parsed and runs *before* the elements it queries for exist
  // in the DOM. Querying immediately silently finds nothing, ever — this
  // guards the deferral that fixes it.
  it("defers its DOM query until DOMContentLoaded, since it always loads before block markup", () => {
    // The query itself lives inside a named `run` function (defined once,
    // ahead of the check below it) so it can be handed to
    // `addEventListener` — the property this test actually cares about is
    // that the query never fires unconditionally at the top level, only
    // from inside that function, gated on readyState.
    expect(SCROLL_REVEAL_BOOTSTRAP_SCRIPT).toMatch(/function run\(\)\{[^]*querySelectorAll/);
    expect(SCROLL_REVEAL_BOOTSTRAP_SCRIPT).toContain('document.readyState === "loading"');
    expect(SCROLL_REVEAL_BOOTSTRAP_SCRIPT).toContain('addEventListener("DOMContentLoaded", run)');
  });
});
