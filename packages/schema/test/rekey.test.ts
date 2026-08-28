import { describe, expect, it } from "vitest";
import { newUlid } from "../src/ids.js";
import type { BlockNode } from "../src/block.js";
import type { PageDocument } from "../src/document.js";
import { rekeyBlocks, rekeyPageForFork } from "../src/rekey.js";

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

describe("rekeyBlocks (ADR-0011 fork-on-use)", () => {
  it("assigns every block a fresh id, preserving the parent/child graph", () => {
    const root = block({ id: newUlid(), order: 1000 });
    const child = block({ id: newUlid(), parent: root.id, order: 1000 });
    const grandchild = block({ id: newUlid(), parent: child.id, order: 1000 });

    const rekeyed = rekeyBlocks([root, child, grandchild]);

    // Every id is fresh — no old id survives.
    const oldIds = new Set([root.id, child.id, grandchild.id]);
    for (const b of rekeyed) expect(oldIds.has(b.id)).toBe(false);

    // The shape of the tree — who is whose parent — survives under the new ids.
    const newRoot = rekeyed.find((b) => b.parent === null)!;
    const newChild = rekeyed.find((b) => b.parent === newRoot.id)!;
    const newGrandchild = rekeyed.find((b) => b.parent === newChild.id)!;
    expect(newChild).toBeDefined();
    expect(newGrandchild).toBeDefined();
    expect(rekeyed).toHaveLength(3);
  });

  it("two rekeys of the same input never collide", () => {
    const blocks = [block({ id: newUlid(), order: 1000 }), block({ id: newUlid(), order: 2000 })];
    const first = rekeyBlocks(blocks);
    const second = rekeyBlocks(blocks);
    const firstIds = new Set(first.map((b) => b.id));
    for (const b of second) expect(firstIds.has(b.id)).toBe(false);
  });

  it("throws rather than silently orphaning a block whose parent is outside the list", () => {
    const orphan = block({ id: newUlid(), parent: newUlid(), order: 1000 });
    expect(() => rekeyBlocks([orphan])).toThrow();
  });

  it("leaves an empty block list empty", () => {
    expect(rekeyBlocks([])).toEqual([]);
  });
});

describe("rekeyPageForFork", () => {
  it("replaces the page id, site id and version, and rekeys every block", () => {
    const root = block({ id: newUlid(), order: 1000 });
    const child = block({ id: newUlid(), parent: root.id, order: 1000 });
    const page: PageDocument = {
      id: newUlid(),
      siteId: newUlid(),
      slug: "home",
      title: "Home",
      schemaVersion: 1,
      version: 7,
      blocks: [root, child],
    };

    const newSiteId = newUlid();
    const newPageId = newUlid();
    const forked = rekeyPageForFork(page, { siteId: newSiteId, pageId: newPageId });

    expect(forked.id).toBe(newPageId);
    expect(forked.siteId).toBe(newSiteId);
    expect(forked.version).toBe(0);
    expect(forked.slug).toBe(page.slug);
    expect(forked.blocks).toHaveLength(2);
    const newRoot = forked.blocks.find((b) => b.parent === null)!;
    const newChild = forked.blocks.find((b) => b.parent === newRoot.id)!;
    expect(newChild).toBeDefined();
    expect(forked.blocks.some((b) => b.id === root.id || b.id === child.id)).toBe(false);
  });
});
