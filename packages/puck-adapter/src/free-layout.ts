import type { BlockNode, FreeRect, LayoutMode } from "@prefab/schema";

/**
 * ADR-0014 / KAN-1129: pure geometry helpers backing the canvas (Puck
 * adapter)'s free-positioning overlay. Deliberately framework-free (no
 * React, no @puckeditor/core) so they're testable without a DOM and reusable
 * from both the interactive overlay (free-canvas.tsx) and the save-path
 * merge (SiteEditor.tsx's handleSave) without those two call sites having to
 * agree on defaulting logic independently.
 */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A sensible default rect for a root block that has never had a position:
 * stacked top-to-bottom, centered horizontally, sized to fit `total` blocks
 * evenly in the canvas with a small gap between them. Deterministic given
 * the same (index, total) so re-deriving it on every render (rather than
 * caching) never causes a block to visibly jump around.
 */
export function defaultFreeRect(index: number, total: number): FreeRect {
  const safeTotal = Math.max(1, total);
  const width = 70;
  const x = (100 - width) / 2;
  const margin = 4;
  const available = 100 - margin * 2;
  const slot = available / safeTotal;
  const height = clamp(slot - margin, 8, 30);
  const y = clamp(margin + index * slot + (slot - height) / 2, 0, 100 - height);
  return { x: clamp(x, 0, 100), y, w: width, h: height, rotate: 0, opacity: 1 };
}

/** Every root-level block's saved `position.base`, keyed by block id — the starting point for a free-canvas session. */
export function initialPositionsFromBlocks(blocks: BlockNode[]): Map<string, FreeRect> {
  const map = new Map<string, FreeRect>();
  for (const block of blocks) {
    if (block.parent === null && block.position) map.set(block.id, block.position.base);
  }
  return map;
}

/**
 * The single place that decides "what rect does this block render/save at
 * right now": the live in-session edit (`positions`, populated by the
 * overlay's drag/resize/rotate/opacity controls) wins; falling back to the
 * rect this block was saved with last (`previous`, from the document that
 * was loaded — carries a toggle-free/toggle-flow/toggle-free cycle's
 * positions across without loss within the same session); falling back to
 * a fresh stacked default for a block that has genuinely never had one
 * (a brand-new block, or a page that has never been "free" before).
 */
export function resolveFreeRect(
  id: string,
  index: number,
  total: number,
  positions: Map<string, FreeRect>,
  previous: Map<string, FreeRect>,
): FreeRect {
  return positions.get(id) ?? previous.get(id) ?? defaultFreeRect(index, total);
}

/**
 * The save-path merge (SiteEditor.tsx's handleSave, after
 * puckDataToPageDocument has already run): folds the overlay's live
 * `positions` map into `blocks`, producing a document that is always valid
 * for the target `layoutMode` —
 *
 * - `"free"`: every root-level block gets a `position` (falling back
 *   through the same precedence `resolveFreeRect` uses, so a save pressed
 *   before the overlay has rendered a single frame still produces valid
 *   positions rather than depending on effect timing).
 * - `"flow"`: `position` is stripped from every block, root or not.
 *
 * Non-root blocks never gain a `position` in either mode (ADR-0014 scopes
 * free positioning to root-level blocks only).
 */
export function applyFreePositions(
  blocks: BlockNode[],
  layoutMode: LayoutMode,
  positions: Map<string, FreeRect>,
): BlockNode[] {
  const rootIds = blocks.filter((b) => b.parent === null).map((b) => b.id);
  const previous = initialPositionsFromBlocks(blocks);

  return blocks.map((block) => {
    if (layoutMode !== "free" || block.parent !== null) {
      if (block.position === undefined) return block;
      const { position: _drop, ...rest } = block;
      return rest;
    }
    const index = rootIds.indexOf(block.id);
    const rect = resolveFreeRect(block.id, index, rootIds.length, positions, previous);
    return { ...block, position: { ...block.position, base: rect } };
  });
}

// ---- interactive geometry (drag-to-move, resize handles, rotate control) ----
// Pure math only — no DOM, no event types — so the overlay component
// (free-canvas.tsx) is a thin layer translating pointer events into calls
// to these, independently unit-testable without a browser/jsdom.

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

/** Smallest a dimension is allowed to shrink to while resizing — prevents a handle drag from collapsing a block to zero/negative size. */
const MIN_SIZE = 4;

/** Drag-to-move: `dx`/`dy` are pointer movement since drag start, already converted to percent-of-canvas by the caller. */
export function moveRectBy(rect: FreeRect, dx: number, dy: number): FreeRect {
  return { ...rect, x: clamp(rect.x + dx, 0, 100), y: clamp(rect.y + dy, 0, 100) };
}

/**
 * Resize from one of the four corner handles: the opposite corner stays
 * anchored, `dx`/`dy` (percent-of-canvas, since drag start) grow or shrink
 * the box and shift the dragged edge(s) accordingly.
 */
export function resizeRectBy(rect: FreeRect, handle: ResizeHandle, dx: number, dy: number): FreeRect {
  let { x, y, w, h } = rect;
  if (handle === "nw" || handle === "sw") {
    x = x + dx;
    w = w - dx;
  } else {
    w = w + dx;
  }
  if (handle === "nw" || handle === "ne") {
    y = y + dy;
    h = h - dy;
  } else {
    h = h + dy;
  }
  return {
    ...rect,
    x: clamp(x, 0, 100),
    y: clamp(y, 0, 100),
    w: clamp(w, MIN_SIZE, 100),
    h: clamp(h, MIN_SIZE, 100),
  };
}

export function rotateRectTo(rect: FreeRect, angle: number): FreeRect {
  return { ...rect, rotate: clamp(angle, -180, 180) };
}

/**
 * Degrees (0 = up, clockwise positive) from a box's center to a pointer
 * position — the rotate handle's whole drag-to-angle math. All arguments
 * are in the same coordinate space (screen px, or any consistent unit).
 */
export function angleFromCenter(centerX: number, centerY: number, pointX: number, pointY: number): number {
  const dx = pointX - centerX;
  const dy = pointY - centerY;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}
