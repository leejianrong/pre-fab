import type { BlockNode } from "./block.js";

/**
 * Flat-tree operations on a block list. "Flat" (ADR-0002) means position is
 * data (`parent` + `order`), never index — every function here returns a
 * new array and never mutates its input, so callers can diff before/after
 * for free.
 */

export const ORDER_GAP = 1000;

export function childrenOf(blocks: BlockNode[], parent: string | null): BlockNode[] {
  return blocks
    .filter((b) => b.parent === parent)
    .slice()
    .sort((a, b) => a.order - b.order);
}

/** Order value for a new last child under `parent`. */
export function nextOrder(blocks: BlockNode[], parent: string | null): number {
  const siblings = childrenOf(blocks, parent);
  const last = siblings.at(-1);
  return last ? last.order + ORDER_GAP : ORDER_GAP;
}

/** Order value strictly between two neighbours (either may be absent, i.e. list start/end). */
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return ORDER_GAP;
  if (before === undefined) return (after as number) / 2;
  if (after === undefined) return before + ORDER_GAP;
  return before + (after - before) / 2;
}

function descendantIds(blocks: BlockNode[], id: string): Set<string> {
  const ids = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const block of blocks) {
      if (block.parent === current && !ids.has(block.id)) {
        ids.add(block.id);
        queue.push(block.id);
      }
    }
  }
  return ids;
}

export interface InsertPosition {
  parent: string | null;
  /** Insert immediately before this sibling id; omit to append at the end. */
  beforeId?: string;
}

export function insertBlock(
  blocks: BlockNode[],
  block: Omit<BlockNode, "order">,
  position: InsertPosition,
): BlockNode[] {
  const siblings = childrenOf(blocks, position.parent);
  const beforeIndex = position.beforeId
    ? siblings.findIndex((b) => b.id === position.beforeId)
    : -1;

  let order: number;
  if (position.beforeId && beforeIndex === -1) {
    throw new Error(`insertBlock: beforeId "${position.beforeId}" is not a sibling under this parent`);
  } else if (beforeIndex === -1) {
    order = nextOrder(blocks, position.parent);
  } else {
    const before = siblings[beforeIndex - 1]?.order;
    const after = siblings[beforeIndex]?.order;
    order = orderBetween(before, after);
  }

  const inserted: BlockNode = { ...block, parent: position.parent, order };
  return [...blocks, inserted];
}

/** Removes a block and every descendant, since a flat list has no other way to express "this subtree is gone". */
export function removeBlock(blocks: BlockNode[], id: string): BlockNode[] {
  const toRemove = new Set([id, ...descendantIds(blocks, id)]);
  return blocks.filter((b) => !toRemove.has(b.id));
}

export function moveBlock(
  blocks: BlockNode[],
  id: string,
  position: InsertPosition,
): BlockNode[] {
  const block = blocks.find((b) => b.id === id);
  if (!block) throw new Error(`moveBlock: no block with id "${id}"`);

  if (position.parent === id || descendantIds(blocks, id).has(position.parent ?? "")) {
    throw new Error(`moveBlock: cannot move block "${id}" into its own subtree`);
  }

  const withoutMoved = blocks.filter((b) => b.id !== id);
  const siblings = childrenOf(withoutMoved, position.parent);
  const beforeIndex = position.beforeId
    ? siblings.findIndex((b) => b.id === position.beforeId)
    : -1;

  let order: number;
  if (position.beforeId && beforeIndex === -1) {
    throw new Error(`moveBlock: beforeId "${position.beforeId}" is not a sibling under this parent`);
  } else if (beforeIndex === -1) {
    order = nextOrder(withoutMoved, position.parent);
  } else {
    const before = siblings[beforeIndex - 1]?.order;
    const after = siblings[beforeIndex]?.order;
    order = orderBetween(before, after);
  }

  const moved: BlockNode = { ...block, parent: position.parent, order };
  return [...withoutMoved, moved];
}

/** Explicit full reorder of one parent's children — renumbers with a clean gap so future inserts have room. */
export function reorderChildren(
  blocks: BlockNode[],
  parent: string | null,
  orderedIds: string[],
): BlockNode[] {
  const siblingIds = new Set(childrenOf(blocks, parent).map((b) => b.id));
  if (siblingIds.size !== orderedIds.length || !orderedIds.every((id) => siblingIds.has(id))) {
    throw new Error("reorderChildren: orderedIds must be exactly the current children of parent");
  }
  const orderById = new Map(orderedIds.map((id, index) => [id, (index + 1) * ORDER_GAP]));
  return blocks.map((b) => (orderById.has(b.id) ? { ...b, order: orderById.get(b.id) as number } : b));
}
