import { describe, expect, it } from "vitest";
import { newUlid } from "../src/ids.js";
import type { BlockNode } from "../src/block.js";
import { diffBlocks, diffPageDocuments, isEmptyDiff } from "../src/diff.js";
import type { PageDocument } from "../src/document.js";

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

describe("diffBlocks", () => {
  it("reports an add for a block only present after", () => {
    const added = block({ id: newUlid() });
    expect(diffBlocks([], [added])).toEqual([{ kind: "add", block: added }]);
  });

  it("reports a remove for a block only present before", () => {
    const removed = block({ id: newUlid() });
    expect(diffBlocks([removed], [])).toEqual([{ kind: "remove", id: removed.id, block: removed }]);
  });

  it("reports a move when parent or order changes", () => {
    const id = newUlid();
    const before = block({ id, parent: null, order: 1000 });
    const after = block({ id, parent: null, order: 2000 });

    const ops = diffBlocks([before], [after]);

    expect(ops).toEqual([
      { kind: "move", id, from: { parent: null, order: 1000 }, to: { parent: null, order: 2000 } },
    ]);
  });

  it("reports an update with changed keys when props change", () => {
    const id = newUlid();
    const before = block({ id, props: { text: "old", color: "red" } });
    const after = block({ id, props: { text: "new", color: "red" } });

    const ops = diffBlocks([before], [after]);

    expect(ops).toEqual([
      { kind: "update", id, changedKeys: ["text"], before: before.props, after: after.props },
    ]);
  });

  it("emits no ops for identical block lists", () => {
    const id = newUlid();
    const b = block({ id, props: { text: "same" } });
    expect(diffBlocks([b], [{ ...b }])).toEqual([]);
  });
});

describe("diffPageDocuments", () => {
  function page(overrides: Partial<PageDocument> = {}): PageDocument {
    return {
      id: newUlid(),
      siteId: newUlid(),
      slug: "home",
      title: "Home",
      schemaVersion: 1,
      version: 0,
      blocks: [],
      ...overrides,
    };
  }

  it("reports a field diff for a changed title", () => {
    const before = page({ title: "Old" });
    const after = page({ ...before, title: "New" });

    const diff = diffPageDocuments(before, after);

    expect(diff.fields).toEqual([{ field: "title", before: "Old", after: "New" }]);
    expect(diff.blocks).toEqual([]);
  });

  it("is empty for two byte-identical documents (round-trip check)", () => {
    const before = page();
    const after = page({ ...before });

    expect(isEmptyDiff(diffPageDocuments(before, after))).toBe(true);
  });
});
