import { describe, expect, it } from "vitest";
import { newUlid } from "../src/ids.js";
import type { BlockNode } from "../src/block.js";
import { childrenOf, insertBlock, moveBlock, removeBlock, reorderChildren } from "../src/tree.js";

function block(overrides: Partial<BlockNode> & { id: string }): BlockNode {
  return {
    type: "test.block",
    parent: null,
    order: 0,
    schemaVersion: 1,
    props: {},
    ...overrides,
  };
}

describe("flat-tree operations", () => {
  it("insertBlock appends at the end by default and preserves the block's id", () => {
    const a = block({ id: newUlid(), order: 1000 });
    const newId = newUlid();
    const result = insertBlock([a], { id: newId, type: "test.block", parent: null, schemaVersion: 1, props: {} }, { parent: null });

    expect(result).toHaveLength(2);
    const inserted = result.find((b) => b.id === newId);
    expect(inserted?.id).toBe(newId);
    expect(inserted?.order).toBeGreaterThan(a.order);
  });

  it("insertBlock places a block strictly between its neighbours when beforeId is given", () => {
    const a = block({ id: newUlid(), order: 1000 });
    const b = block({ id: newUlid(), order: 2000 });
    const newId = newUlid();

    const result = insertBlock(
      [a, b],
      { id: newId, type: "test.block", parent: null, schemaVersion: 1, props: {} },
      { parent: null, beforeId: b.id },
    );

    const ordered = childrenOf(result, null);
    expect(ordered.map((n) => n.id)).toEqual([a.id, newId, b.id]);
  });

  it("moveBlock reparents a block while preserving its id and props", () => {
    const parentA = block({ id: newUlid(), order: 1000 });
    const parentB = block({ id: newUlid(), order: 2000 });
    const child = block({ id: newUlid(), parent: parentA.id, order: 1000, props: { text: "keep me" } });

    const result = moveBlock([parentA, parentB, child], child.id, { parent: parentB.id });

    const moved = result.find((n) => n.id === child.id);
    expect(moved?.parent).toBe(parentB.id);
    expect(moved?.props).toEqual({ text: "keep me" });
    expect(result).toHaveLength(3);
  });

  it("moveBlock refuses to move a block into its own subtree", () => {
    const parent = block({ id: newUlid(), order: 1000 });
    const child = block({ id: newUlid(), parent: parent.id, order: 1000 });

    expect(() => moveBlock([parent, child], parent.id, { parent: child.id })).toThrow();
  });

  it("removeBlock cascades to descendants", () => {
    const parent = block({ id: newUlid(), order: 1000 });
    const child = block({ id: newUlid(), parent: parent.id, order: 1000 });
    const grandchild = block({ id: newUlid(), parent: child.id, order: 1000 });
    const unrelated = block({ id: newUlid(), order: 2000 });

    const result = removeBlock([parent, child, grandchild, unrelated], parent.id);

    expect(result.map((n) => n.id)).toEqual([unrelated.id]);
  });

  it("reorderChildren renumbers siblings to match the given order, ids untouched", () => {
    const a = block({ id: newUlid(), order: 1000 });
    const b = block({ id: newUlid(), order: 2000 });
    const c = block({ id: newUlid(), order: 3000 });

    const result = reorderChildren([a, b, c], null, [c.id, a.id, b.id]);

    expect(childrenOf(result, null).map((n) => n.id)).toEqual([c.id, a.id, b.id]);
    expect(result.map((n) => n.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });
});
