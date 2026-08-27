import { z } from "zod";
import { UlidSchema } from "./ids.js";
import { BlockNodeSchema, type BlockNode } from "./block.js";

/** The document envelope's own format version — independent of any one block's schemaVersion. */
export const DOCUMENT_SCHEMA_VERSION = 1;

export const PageDocumentSchema = z.object({
  id: UlidSchema,
  siteId: UlidSchema,
  slug: z.string().min(1),
  title: z.string(),
  schemaVersion: z.number().int().nonnegative(),
  /** Optimistic-concurrency version (ADR-0006 / R17). Incremented on every accepted write. */
  version: z.number().int().nonnegative(),
  blocks: z.array(BlockNodeSchema),
});

export type PageDocument = z.infer<typeof PageDocumentSchema>;

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
    blocks: [],
  };
}

export type { BlockNode };
