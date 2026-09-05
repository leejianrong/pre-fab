import { describe, expect, it } from "vitest";
import { createEmptyPage, newUlid, type BlockNode, type FreeRect } from "@prefab/schema";
import { HERO_BLOCK_TYPE, heroDefaultProps } from "@prefab/blocks";
import { blockSchemaRegistry } from "@prefab/blocks";
import { validatePageDocument } from "@prefab/schema";
import {
  angleFromCenter,
  applyFreePositions,
  defaultFreeRect,
  initialPositionsFromBlocks,
  moveRectBy,
  resizeRectBy,
  resolveFreeRect,
  rotateRectTo,
} from "../src/free-layout.js";

function heroBlock(overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id: newUlid(),
    type: HERO_BLOCK_TYPE,
    parent: null,
    order: 1000,
    schemaVersion: 1,
    props: { ...heroDefaultProps },
    responsive: {},
    ...overrides,
  };
}

function isValidRect(rect: FreeRect) {
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x).toBeLessThanOrEqual(100);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeLessThanOrEqual(100);
  expect(rect.w).toBeGreaterThanOrEqual(0);
  expect(rect.w).toBeLessThanOrEqual(100);
  expect(rect.h).toBeGreaterThanOrEqual(0);
  expect(rect.h).toBeLessThanOrEqual(100);
  expect(rect.rotate).toBeGreaterThanOrEqual(-180);
  expect(rect.rotate).toBeLessThanOrEqual(180);
  expect(rect.opacity).toBeGreaterThanOrEqual(0);
  expect(rect.opacity).toBeLessThanOrEqual(1);
}

describe("defaultFreeRect", () => {
  it("produces schema-valid rects for every index in a stack of several blocks", () => {
    const total = 5;
    for (let i = 0; i < total; i++) {
      isValidRect(defaultFreeRect(i, total));
    }
  });

  it("is deterministic for the same (index, total) — a block never jumps around across renders", () => {
    expect(defaultFreeRect(2, 4)).toEqual(defaultFreeRect(2, 4));
  });

  it("handles a single block (total=1) without dividing by zero", () => {
    isValidRect(defaultFreeRect(0, 1));
  });
});

describe("initialPositionsFromBlocks", () => {
  it("collects only root blocks that already have a position", () => {
    const positioned = heroBlock({ position: { base: { x: 1, y: 2, w: 3, h: 4, rotate: 0, opacity: 1 } } });
    const unpositioned = heroBlock();
    const nonRoot = heroBlock({ parent: positioned.id, position: undefined });
    const map = initialPositionsFromBlocks([positioned, unpositioned, nonRoot]);
    expect(map.size).toBe(1);
    expect(map.get(positioned.id)).toEqual({ x: 1, y: 2, w: 3, h: 4, rotate: 0, opacity: 1 });
  });
});

describe("resolveFreeRect", () => {
  it("prefers a live position over the previously-saved one, and that over a fresh default", () => {
    const live: FreeRect = { x: 10, y: 10, w: 10, h: 10, rotate: 0, opacity: 1 };
    const saved: FreeRect = { x: 20, y: 20, w: 20, h: 20, rotate: 0, opacity: 1 };
    const positions = new Map([["a", live]]);
    const previous = new Map([["a", saved], ["b", saved]]);

    expect(resolveFreeRect("a", 0, 2, positions, previous)).toEqual(live);
    expect(resolveFreeRect("b", 0, 2, positions, previous)).toEqual(saved);
    expect(resolveFreeRect("c", 0, 2, positions, previous)).toEqual(defaultFreeRect(0, 2));
  });
});

describe("applyFreePositions", () => {
  it("flow -> free: assigns a valid default position.base to every root block with none, with no drag having happened", () => {
    const blocks = [heroBlock(), heroBlock(), heroBlock()];
    const result = applyFreePositions(blocks, "free", new Map());

    expect(result).toHaveLength(3);
    for (const block of result) {
      expect(block.position).toBeDefined();
      isValidRect(block.position!.base);
    }

    // The resulting document is exactly what validatePageDocument approves —
    // not just "shaped right" by inspection.
    const page = createEmptyPage({ id: newUlid(), siteId: newUlid(), slug: "home", title: "Home" });
    page.layoutMode = "free";
    page.blocks = result;
    const validated = validatePageDocument(page, blockSchemaRegistry);
    expect(validated.ok).toBe(true);
  });

  it("free -> flow: strips position from every block, root or not", () => {
    const root = heroBlock({ position: { base: { x: 1, y: 1, w: 1, h: 1, rotate: 0, opacity: 1 } } });
    const blocks = [root];
    const result = applyFreePositions(blocks, "flow", new Map());

    expect(result).toHaveLength(1);
    expect(result[0]?.position).toBeUndefined();
    expect("position" in result[0]!).toBe(false);

    const page = createEmptyPage({ id: newUlid(), siteId: newUlid(), slug: "home", title: "Home" });
    page.layoutMode = "flow";
    page.blocks = result;
    const validated = validatePageDocument(page, blockSchemaRegistry);
    expect(validated.ok).toBe(true);
  });

  it("preserves a block's existing position.base when no live override is given for it, and applies a live one when given", () => {
    const untouched = heroBlock({ position: { base: { x: 5, y: 6, w: 7, h: 8, rotate: 0, opacity: 1 } } });
    const dragged = heroBlock({ position: { base: { x: 50, y: 50, w: 10, h: 10, rotate: 0, opacity: 1 } } });
    const newRect: FreeRect = { x: 99, y: 1, w: 20, h: 20, rotate: 45, opacity: 0.5 };
    const positions = new Map([[dragged.id, newRect]]);

    const result = applyFreePositions([untouched, dragged], "free", positions);
    expect(result.find((b) => b.id === untouched.id)?.position?.base).toEqual({ x: 5, y: 6, w: 7, h: 8, rotate: 0, opacity: 1 });
    expect(result.find((b) => b.id === dragged.id)?.position?.base).toEqual(newRect);
  });

  it("never touches a non-root block's position (out of ADR-0014's scope)", () => {
    const root = heroBlock();
    const child = heroBlock({ parent: root.id });
    const result = applyFreePositions([root, child], "free", new Map());
    expect(result.find((b) => b.id === child.id)?.position).toBeUndefined();
  });
});

describe("interactive geometry", () => {
  const rect: FreeRect = { x: 40, y: 40, w: 20, h: 20, rotate: 0, opacity: 1 };

  it("moveRectBy translates and clamps to [0,100]", () => {
    expect(moveRectBy(rect, 5, -5)).toEqual({ ...rect, x: 45, y: 35 });
    expect(moveRectBy(rect, 1000, -1000).x).toBe(100);
    expect(moveRectBy(rect, 1000, -1000).y).toBe(0);
  });

  it("resizeRectBy grows from the se handle without moving the anchor corner", () => {
    const result = resizeRectBy(rect, "se", 10, 10);
    expect(result).toEqual({ ...rect, w: 30, h: 30 });
  });

  it("resizeRectBy shrinks from the nw handle, moving x/y and shrinking w/h together", () => {
    const result = resizeRectBy(rect, "nw", 5, 5);
    expect(result).toEqual({ ...rect, x: 45, y: 45, w: 15, h: 15 });
  });

  it("resizeRectBy never collapses a dimension below the minimum", () => {
    const result = resizeRectBy(rect, "se", -1000, -1000);
    expect(result.w).toBeGreaterThan(0);
    expect(result.h).toBeGreaterThan(0);
  });

  it("rotateRectTo clamps to [-180, 180]", () => {
    expect(rotateRectTo(rect, 45).rotate).toBe(45);
    expect(rotateRectTo(rect, 999).rotate).toBe(180);
    expect(rotateRectTo(rect, -999).rotate).toBe(-180);
  });

  it("angleFromCenter reports 0 for a point directly above center, 90 for directly right", () => {
    expect(angleFromCenter(100, 100, 100, 50)).toBeCloseTo(0);
    expect(angleFromCenter(100, 100, 150, 100)).toBeCloseTo(90);
    expect(angleFromCenter(100, 100, 100, 150)).toBeCloseTo(180);
    expect(angleFromCenter(100, 100, 50, 100)).toBeCloseTo(-90);
  });
});
