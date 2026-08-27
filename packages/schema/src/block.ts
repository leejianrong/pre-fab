import { z } from "zod";
import { UlidSchema } from "./ids.js";

/**
 * A block is a node in a flat list, never a nested tree (ADR-0002). Position
 * is expressed as `parent` + `order`, so an agent patch addresses a block by
 * its ULID and never by "the third child of X".
 *
 * `props` is intentionally untyped at this layer: a block whose `type` this
 * build does not recognise must still round-trip losslessly (R19), so the
 * envelope never refuses to hold props it cannot validate.
 */
export const BlockNodeSchema = z.object({
  id: UlidSchema,
  type: z.string().min(1),
  parent: UlidSchema.nullable(),
  order: z.number().finite(),
  schemaVersion: z.number().int().nonnegative(),
  props: z.record(z.string(), z.unknown()),
});

export type BlockNode = z.infer<typeof BlockNodeSchema>;

export const BlockListSchema = z.array(BlockNodeSchema);
