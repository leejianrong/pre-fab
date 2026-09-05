import { z } from "zod";
import { UlidSchema } from "./ids.js";
import { BlockNodeSchema, type BlockNode } from "./block.js";

/** The document envelope's own format version — independent of any one block's schemaVersion. */
export const DOCUMENT_SCHEMA_VERSION = 2;

/**
 * ADR-0014 (KAN-1129): a page opts into free positioning per page, not
 * site-wide. `"flow"` is today's stacked-section model, unchanged; `"free"`
 * lets root-level blocks carry `position` (block.ts) instead of relying on
 * `parent`/`order` for visual placement (those are kept even on a "free"
 * page — see the ADR's point 4 — as the z-stack order and the mandatory
 * reading-order/accessibility/export fallback).
 */
export const LayoutModeSchema = z.enum(["flow", "free"]);
export type LayoutMode = z.infer<typeof LayoutModeSchema>;

export const PageDocumentSchema = z.object({
  id: UlidSchema,
  siteId: UlidSchema,
  slug: z.string().min(1),
  title: z.string(),
  schemaVersion: z.number().int().nonnegative(),
  /** Optimistic-concurrency version (ADR-0006 / R17). Incremented on every accepted write. */
  version: z.number().int().nonnegative(),
  /**
   * Defaults to `"flow"` so a document that predates this field (every page
   * written before DOCUMENT_SCHEMA_VERSION 2) parses as `"flow"` with zero
   * data change — the forward migration ADR-0014 asks for. See also
   * `migrateLegacyPageDocument` below, which makes that same default
   * explicit and independently testable for callers that hand this schema
   * a plain, unvalidated object (e.g. a pre-migration export file) rather
   * than relying on this default firing implicitly during `.parse`.
   */
  layoutMode: LayoutModeSchema.default("flow"),
  blocks: z.array(BlockNodeSchema),
});

export type PageDocument = z.infer<typeof PageDocumentSchema>;

/**
 * The document envelope's first-ever schema version bump (1 -> 2, ADR-0014):
 * a document with no `layoutMode` key predates the field and is treated as
 * `"flow"`, with every other field — critically, `blocks` — left completely
 * untouched. This mirrors `migrateBlockProps` (registry.ts) in spirit —
 * forward-only, keyed by what's missing rather than guessed at — but it
 * migrates the envelope itself rather than one block's `props`, so it isn't
 * shaped as that same `Record<fromVersion, fn>` chain: there is exactly one
 * step so far (add a field, default it), not a per-block-type chain of
 * prop transformations. A second envelope-level change, if one ever comes,
 * is the point to decide whether that chain shape is worth adopting here
 * too — not before, per CLAUDE.md's "no refactor beyond this slice."
 *
 * Safe to call on anything, including a value that isn't a plain object —
 * callers (`validatePageDocument`) still run the result through
 * `PageDocumentSchema.safeParse`, which is the actual source of truth for
 * whether the input was ever a valid document at all.
 */
export function migrateLegacyPageDocument(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  if ("layoutMode" in input) return input;
  return { ...(input as Record<string, unknown>), layoutMode: "flow" as const };
}

export function createEmptyPage(input: {
  id: string;
  siteId: string;
  slug: string;
  title: string;
}): PageDocument {
  return {
    id: input.id,
    siteId: input.siteId,
    slug: input.slug,
    title: input.title,
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    version: 0,
    layoutMode: "flow",
    blocks: [],
  };
}

export type { BlockNode };
