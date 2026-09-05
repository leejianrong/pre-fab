import { PageDocumentSchema, migrateLegacyPageDocument, type PageDocument } from "./document.js";
import type { BlockNode } from "./block.js";
import type { BlockRegistry } from "./registry.js";
import { migrateBlockProps } from "./registry.js";
import type { ValidationIssue } from "./errors.js";

export type DocumentValidationResult =
  | { ok: true; issues: []; document: PageDocument }
  | { ok: false; issues: ValidationIssue[]; document?: undefined };

interface RawIssue {
  path: PropertyKey[];
  message: string;
}

function zodIssuesToValidationIssues(
  blockId: string | null,
  zodIssues: RawIssue[],
  pathPrefix: (string | number)[] = [],
): ValidationIssue[] {
  return zodIssues.map((issue) => ({
    blockId,
    path: [...pathPrefix, ...issue.path.map((p) => (typeof p === "symbol" ? String(p) : p))],
    message: issue.message,
  }));
}

/**
 * Validates a whole page document: the flat-list envelope, then each
 * block's props against its registered type. A block whose type is not in
 * the registry is preserved untouched rather than rejected (R19) — it is
 * simply not deep-validated, since this build has no schema for it.
 *
 * Returns every issue found rather than stopping at the first, because R18
 * requires the caller to reject the whole patch atomically and report every
 * problem in one round trip, not one-error-per-retry.
 */
export function validatePageDocument(
  input: unknown,
  registry: BlockRegistry,
): DocumentValidationResult {
  // ADR-0014 / KAN-1129: a document that predates `layoutMode` is migrated
  // to `"flow"` before the envelope is even parsed, so a legacy document
  // that reaches this function through some path other than
  // `PageDocumentSchema`'s own `.default()` (e.g. a raw object read off
  // disk) still lands on the same result.
  const migratedInput = migrateLegacyPageDocument(input);
  const envelope = PageDocumentSchema.safeParse(migratedInput);
  if (!envelope.success) {
    return {
      ok: false,
      issues: zodIssuesToValidationIssues(null, envelope.error.issues),
    };
  }

  const issues: ValidationIssue[] = [];
  const migratedBlocks: BlockNode[] = [];

  for (const block of envelope.data.blocks) {
    // ADR-0014: `position` is required exactly when this block is
    // root-level on a "free" page, and rejected everywhere else — a block
    // never carries position data that nothing will read, and a "free"
    // page's root blocks are never silently unplaced. Checked ahead of the
    // per-block-type validation below since it's envelope-level, not
    // dependent on the block's `type` being registered at all (R19: even
    // an unrecognised block type must satisfy this).
    const requiresPosition = envelope.data.layoutMode === "free" && block.parent === null;
    if (requiresPosition && block.position === undefined) {
      issues.push({
        blockId: block.id,
        path: ["position"],
        message: `position is required for a root-level block on a "free" layoutMode page`,
      });
      continue;
    }
    if (!requiresPosition && block.position !== undefined) {
      issues.push({
        blockId: block.id,
        path: ["position"],
        message:
          envelope.data.layoutMode === "flow"
            ? `position must be absent on a "flow" layoutMode page`
            : `position must be absent on a non-root block (only root-level blocks on a "free" page carry position)`,
      });
      continue;
    }

    const definition = registry.get(block.type);
    if (!definition) {
      // Unknown block type: preserved as-is (R19). Renderer/editor decide
      // how to display it; this layer only guarantees it is not dropped.
      migratedBlocks.push(block);
      continue;
    }

    let migratedProps: Record<string, unknown>;
    try {
      migratedProps = migrateBlockProps(definition, block.props, block.schemaVersion);
    } catch (error) {
      issues.push({
        blockId: block.id,
        path: ["schemaVersion"],
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const propsResult = definition.propsSchema.safeParse(migratedProps);
    if (!propsResult.success) {
      issues.push(
        ...zodIssuesToValidationIssues(block.id, propsResult.error.issues, ["props"]),
      );
      continue;
    }

    migratedBlocks.push({
      ...block,
      schemaVersion: definition.version,
      props: propsResult.data as Record<string, unknown>,
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    issues: [],
    document: { ...envelope.data, blocks: migratedBlocks },
  };
}
