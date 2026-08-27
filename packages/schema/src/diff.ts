import type { BlockNode } from "./block.js";
import type { PageDocument } from "./document.js";

export type BlockDiffOp =
  | { kind: "add"; block: BlockNode }
  | { kind: "remove"; id: string; block: BlockNode }
  | {
      kind: "move";
      id: string;
      from: { parent: string | null; order: number };
      to: { parent: string | null; order: number };
    }
  | { kind: "update"; id: string; changedKeys: string[]; before: Record<string, unknown>; after: Record<string, unknown> };

function shallowPropsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => deepEqual(a[key], b[key]));
}

// A plain JSON.stringify comparison is key-order sensitive, and a value
// round-tripped through Postgres jsonb is not guaranteed to come back with
// the same key order it went in with — so this recurses structurally
// instead of serializing.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

function changedKeysOf(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (!deepEqual(before[key], after[key])) changed.push(key);
  }
  return changed;
}

/**
 * Structural diff between two block lists, by id. Used by `prefab diff` (R17
 * conflict payloads) and by the round-trip test's human-readable failure
 * output. Order in the returned array is: removes, adds, moves, updates.
 */
export function diffBlocks(before: BlockNode[], after: BlockNode[]): BlockDiffOp[] {
  const beforeById = new Map(before.map((b) => [b.id, b]));
  const afterById = new Map(after.map((b) => [b.id, b]));
  const ops: BlockDiffOp[] = [];

  for (const block of before) {
    if (!afterById.has(block.id)) {
      ops.push({ kind: "remove", id: block.id, block });
    }
  }
  for (const block of after) {
    if (!beforeById.has(block.id)) {
      ops.push({ kind: "add", block });
    }
  }
  for (const block of after) {
    const prev = beforeById.get(block.id);
    if (!prev) continue;
    if (prev.parent !== block.parent || prev.order !== block.order) {
      ops.push({
        kind: "move",
        id: block.id,
        from: { parent: prev.parent, order: prev.order },
        to: { parent: block.parent, order: block.order },
      });
    }
    if (!shallowPropsEqual(prev.props, block.props)) {
      ops.push({
        kind: "update",
        id: block.id,
        changedKeys: changedKeysOf(prev.props, block.props),
        before: prev.props,
        after: block.props,
      });
    }
  }
  return ops;
}

export interface FieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

export interface DocumentDiff {
  fields: FieldDiff[];
  blocks: BlockDiffOp[];
}

const DIFFED_FIELDS = ["title", "slug"] as const;

export function diffPageDocuments(before: PageDocument, after: PageDocument): DocumentDiff {
  const fields: FieldDiff[] = [];
  for (const field of DIFFED_FIELDS) {
    if (before[field] !== after[field]) {
      fields.push({ field, before: before[field], after: after[field] });
    }
  }
  return { fields, blocks: diffBlocks(before.blocks, after.blocks) };
}

export function isEmptyDiff(diff: DocumentDiff): boolean {
  return diff.fields.length === 0 && diff.blocks.length === 0;
}
