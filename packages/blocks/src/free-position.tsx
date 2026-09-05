import {
  BREAKPOINTS,
  BREAKPOINT_MIN_WIDTH,
  isUlid,
  type BlockNode,
  type FreePosition,
  type FreeRect,
  type OverridableBreakpoint,
} from "@prefab/schema";

/**
 * ADR-0014 (KAN-1129)'s render path: the free-positioning equivalent of
 * responsive.tsx's `responsiveStyleCss`/`ResponsiveStyle`. A `"free"` page's
 * root-level blocks each carry a `position` (packages/schema/src/
 * free-position.ts, base/md/lg percent-of-canvas rects) instead of relying
 * on document flow; this module turns that geometry into CSS.
 *
 * Deliberately page-template-level rather than block-level: positioning is
 * about which container a block's own markup sits inside, not something a
 * block renders about itself, so @prefab/publish's page-template.ts is the
 * only caller — it wraps each root-level block's already-rendered markup in
 * the container this module describes. No first-party block file imports
 * anything from here, unlike `ResponsiveStyle` (which every block renders
 * itself); see page-template.ts's own comment for why that split is
 * deliberate.
 */

function rectDeclarations(rect: Partial<FreeRect>): string[] {
  const decls: string[] = [];
  if (rect.x !== undefined) decls.push(`left:${rect.x}%`);
  if (rect.y !== undefined) decls.push(`top:${rect.y}%`);
  if (rect.w !== undefined) decls.push(`width:${rect.w}%`);
  if (rect.h !== undefined) decls.push(`height:${rect.h}%`);
  if (rect.rotate !== undefined) decls.push(`transform:rotate(${rect.rotate}deg)`);
  if (rect.opacity !== undefined) decls.push(`opacity:${rect.opacity}`);
  return decls;
}

/**
 * The free canvas's baseline height in px — mirrored from the
 * already-merged Puck-adapter free canvas (packages/puck-adapter/src/
 * free-canvas.tsx's own `minHeight: 560`, KAN-1129 part 3), not a new
 * invented number. A `"free"` page's positioned children are all
 * `position:absolute`, so nothing in normal document flow gives their
 * containing block a height of its own; CSS resolves a percentage
 * `top`/`height` on an absolutely-positioned element against the
 * *containing block's own height*, and only when that height is
 * definite — an "auto"-height container (which this one would otherwise
 * be, since every child is removed from flow) makes the browser treat the
 * percentage as unresolved instead, collapsing every block's `y`/`h` to 0
 * (verified against a real headless-browser layout while building this).
 * The canvas root needs an explicit floor to fix that; using the exact
 * number the editor's own canvas already uses is what keeps a block's
 * authored position visually matching between the Puck canvas and the
 * published page (ADR-0004's WYSIWYG guarantee) instead of introducing a
 * second, disagreeing baseline. Duplicated here rather than imported —
 * packages/puck-adapter is editor-only and out of this slice's scope — so
 * if this number ever changes, it has to change in both places by hand.
 */
export const FREE_CANVAS_BASE_HEIGHT_PX = 560;

/**
 * The positioned canvas root every wrapped root block's `left`/`top`/
 * `width`/`height` percentages resolve against. `minHeight`, not `height`:
 * a floor for percentage math, not a clip — a real visitor's page must
 * never crop content the way the editor's own bounded editing viewport is
 * free to (that one also sets `overflow: hidden`, deliberately not
 * mirrored here).
 */
export function freeCanvasRootStyle(): Record<string, string> {
  return { position: "relative", minHeight: `${FREE_CANVAS_BASE_HEIGHT_PX}px` };
}

/**
 * The `base` rect as an inline-style object for a positioned block's
 * wrapper `<div>` — unconditional, not media-gated, exactly the way a
 * block's own "no override" rendering has no breakpoint concept in
 * responsive.tsx. `zIndex` is ADR-0014 point 4's z-stack order ("higher
 * `order` paints on top") expressed as an integer rank rather than
 * `order`'s own value, which `orderBetween` (packages/schema/src/tree.ts)
 * can make fractional — CSS `z-index` only accepts integers, and relative
 * rank is all "higher = on top" actually needs (see
 * `rankRootBlocksForStacking` below). Omitted (no `zIndex` key at all) when
 * the caller passes none, e.g. a standalone single free block.
 */
export function freePositionBaseStyle(rect: FreeRect, zIndex?: number): Record<string, string> {
  const style: Record<string, string> = {
    position: "absolute",
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.w}%`,
    height: `${rect.h}%`,
    transform: `rotate(${rect.rotate}deg)`,
    opacity: `${rect.opacity}`,
  };
  if (zIndex !== undefined) style.zIndex = `${zIndex}`;
  return style;
}

/**
 * Pure string builder (no React, no DOM) — mirrors `responsiveStyleCss`
 * exactly: `md`/`lg` overrides only (never `base`, which is the wrapper's
 * own unconditional inline style above, produced by `freePositionBaseStyle`),
 * emitted as `!important`-boosted `@media (min-width:...)` rules. Renders
 * nothing when a breakpoint has no override, the same "nothing to override"
 * behaviour `responsiveStyleCss` has. Keyed to `data-pf-free-block-id` —
 * kept distinct from `data-pf-block-id` (which every block already carries,
 * consumed by `responsiveStyleCss` and the fidelity harness) so a positioned
 * block's two independent style concerns, its own content styling and its
 * page-level placement, never share one selector.
 */
export function freePositionStyleCss(blockId: string, position: FreePosition): string {
  if (!isUlid(blockId)) return "";

  let css = "";
  for (const bp of BREAKPOINTS as readonly OverridableBreakpoint[]) {
    const rect = position[bp];
    if (!rect) continue;
    const decls = rectDeclarations(rect);
    if (decls.length === 0) continue;
    css += `@media (min-width:${BREAKPOINT_MIN_WIDTH[bp]}){[data-pf-free-block-id="${blockId}"]{${decls
      .map((d) => `${d} !important`)
      .join(";")}}}`;
  }
  return css;
}

/**
 * Renders `freePositionStyleCss` as a `<style>` tag — the same thin-wrapper
 * relationship `ResponsiveStyle` has to `responsiveStyleCss`. Unlike
 * `ResponsiveStyle`, no first-party block renders this itself:
 * page-template.ts renders one per positioned root block, right alongside
 * the wrapper `<div>` it also owns, which is what keeps free positioning
 * from needing any change to the ~30 existing block components (see this
 * file's module comment).
 */
export function FreePositionStyle({ blockId, position }: { blockId: string; position: FreePosition }) {
  const css = freePositionStyleCss(blockId, position);
  if (!css) return null;
  return <style>{css}</style>;
}

/**
 * ADR-0014 point 4: `order` is a free page's z-stack order, higher paints
 * on top. Returns each root-level block's rank (1-based, ascending by
 * `order`) as a plain integer suitable for CSS `z-index` — computed
 * separately from `order`'s own value, which `orderBetween`
 * (packages/schema/src/tree.ts) can make fractional as siblings are
 * inserted between existing ones. Non-root blocks are never included:
 * they're out of ADR-0014's scope entirely (no `position`, never wrapped).
 */
export function rankRootBlocksForStacking(blocks: readonly BlockNode[]): Map<string, number> {
  const rootBlocks = blocks
    .filter((b) => b.parent === null)
    .slice()
    .sort((a, b) => a.order - b.order);
  const ranks = new Map<string, number>();
  rootBlocks.forEach((b, index) => ranks.set(b.id, index + 1));
  return ranks;
}
