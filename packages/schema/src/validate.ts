import { PageDocumentSchema, type PageDocument } from "./document.js";
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
  const envelope = PageDocumentSchema.safeParse(input);
  if (!envelope.success) {
    return {
      ok: false,
      issues: zodIssuesToValidationIssues(null, envelope.error.issues),
    };
  }

  const issues: ValidationIssue[] = [];
  const migratedBlocks: BlockNode[] = [];

  for (const block of envelope.data.blocks) {
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
