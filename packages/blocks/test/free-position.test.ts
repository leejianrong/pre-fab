import { describe, expect, it } from "vitest";
import { newUlid } from "@prefab/schema";
import {
  freeCanvasRootStyle,
  freePositionBaseStyle,
  freePositionStyleCss,
  rankRootBlocksForStacking,
} from "../src/free-position.js";

const BASE_RECT = { x: 10, y: 20, w: 30, h: 40, rotate: 0, opacity: 1 };

describe("freeCanvasRootStyle", () => {
  it("gives the canvas root a definite height, not just position:relative", () => {
    // Every positioned block is `position:absolute`, so nothing in normal
    // flow gives this container a height of its own — a percentage
    // `top`/`height` on an absolutely-positioned child only resolves
    // against a *definite* containing-block height (verified against a
    // real headless-browser layout while building this: an "auto"-height
    // container collapses every child's y/h to 0 instead). `minHeight`,
    // not `height`, is what keeps this a floor rather than a clip.
    const style = freeCanvasRootStyle();
    expect(style.position).toBe("relative");
    expect(style.minHeight).toMatch(/^\d+px$/);
    expect(style.height).toBeUndefined();
    expect(style.overflow).toBeUndefined();
  });
});

describe("freePositionBaseStyle", () => {
  it("renders the base rect as an unconditional absolute-position style object", () => {
    const style = freePositionBaseStyle(BASE_RECT);
    expect(style).toEqual({
      position: "absolute",
      left: "10%",
      top: "20%",
      width: "30%",
      height: "40%",
      transform: "rotate(0deg)",
      opacity: "1",
    });
  });

  it("renders a non-zero rotate and a fractional opacity", () => {
    const style = freePositionBaseStyle({ x: 0, y: 0, w: 100, h: 100, rotate: -45, opacity: 0.5 });
    expect(style.transform).toBe("rotate(-45deg)");
    expect(style.opacity).toBe("0.5");
  });

  it("includes zIndex only when a rank is supplied", () => {
    expect(freePositionBaseStyle(BASE_RECT)).not.toHaveProperty("zIndex");
    expect(freePositionBaseStyle(BASE_RECT, 3).zIndex).toBe("3");
  });
});

describe("freePositionStyleCss", () => {
  it("emits nothing when a block has no md/lg override", () => {
    expect(freePositionStyleCss(newUlid(), { base: BASE_RECT })).toBe("");
  });

  it("emits nothing for a non-ULID id, regardless of overrides", () => {
    expect(freePositionStyleCss("not-a-ulid", { base: BASE_RECT, md: { x: 50 } })).toBe("");
  });

  it("emits an !important media rule scoped to the free-position data attribute, not data-pf-block-id", () => {
    const id = newUlid();
    const css = freePositionStyleCss(id, { base: BASE_RECT, md: { x: 5, y: 6 } });
    expect(css).toContain(`[data-pf-free-block-id="${id}"]`);
    expect(css).not.toContain("data-pf-block-id=");
    expect(css).toContain("@media (min-width:640px)");
    expect(css).toContain("left:5% !important");
    expect(css).toContain("top:6% !important");
  });

  it("emits only the fields an override actually names, leaving the rest to the base rect", () => {
    const id = newUlid();
    const css = freePositionStyleCss(id, { base: BASE_RECT, md: { w: 99 } });
    expect(css).toContain("width:99% !important");
    expect(css).not.toContain("left:");
    expect(css).not.toContain("top:");
    expect(css).not.toContain("height:");
  });

  it("cascades md and lg independently, each in its own media query", () => {
    const id = newUlid();
    const css = freePositionStyleCss(id, {
      base: BASE_RECT,
      md: { x: 1, rotate: 10 },
      lg: { x: 2 },
    });
    expect(css).toContain("@media (min-width:640px)");
    expect(css).toContain("left:1% !important");
    expect(css).toContain("transform:rotate(10deg) !important");
    expect(css).toContain("@media (min-width:1024px)");
    expect(css).toContain("left:2% !important");
    // lg doesn't re-name rotate, but this is a media-query cascade (CSS,
    // not JS merge) — an lg viewport keeps md's rotate rule in effect
    // simply because both rules apply at that width, not because this
    // function re-emits it. So the lg block's own declarations contain
    // exactly what lg named, nothing borrowed from md.
    const lgRuleStart = css.indexOf("@media (min-width:1024px)");
    const lgRule = css.slice(lgRuleStart);
    expect(lgRule).not.toContain("rotate");
  });

  it("emits no rule for a breakpoint with an override object but no recognised fields set", () => {
    const id = newUlid();
    // md present but empty (defensive: schema allows an empty partial)
    const css = freePositionStyleCss(id, { base: BASE_RECT, md: {} });
    expect(css).toBe("");
  });
});

describe("rankRootBlocksForStacking", () => {
  it("ranks root blocks 1-based, ascending by order", () => {
    const a = { id: newUlid(), parent: null, order: 3000 };
    const b = { id: newUlid(), parent: null, order: 1000 };
    const c = { id: newUlid(), parent: null, order: 2000 };
    const ranks = rankRootBlocksForStacking([a, b, c] as never);
    expect(ranks.get(b.id)).toBe(1);
    expect(ranks.get(c.id)).toBe(2);
    expect(ranks.get(a.id)).toBe(3);
  });

  it("handles a fractional order (orderBetween-style inserts) without breaking rank order", () => {
    const low = { id: newUlid(), parent: null, order: 1000 };
    const mid = { id: newUlid(), parent: null, order: 1500.5 };
    const high = { id: newUlid(), parent: null, order: 2000 };
    const ranks = rankRootBlocksForStacking([high, low, mid] as never);
    expect(ranks.get(low.id)).toBe(1);
    expect(ranks.get(mid.id)).toBe(2);
    expect(ranks.get(high.id)).toBe(3);
  });

  it("excludes non-root blocks entirely", () => {
    const root = { id: newUlid(), parent: null, order: 1000 };
    const child = { id: newUlid(), parent: root.id, order: 1000 };
    const ranks = rankRootBlocksForStacking([root, child] as never);
    expect(ranks.size).toBe(1);
    expect(ranks.has(child.id)).toBe(false);
  });
});
