import { z } from "zod";
import { UlidSchema } from "./ids.js";
import { BlockResponsiveSchema } from "./responsive.js";
import { FreePositionSchema } from "./free-position.js";

/**
 * A block is a node in a flat list, never a nested tree (ADR-0002). Position
 * in the reading-order/z-stack sense is expressed as `parent` + `order`, so
 * an agent patch addresses a block by its ULID and never by "the third
 * child of X".
 *
 * `props` is intentionally untyped at this layer: a block whose `type` this
 * build does not recognise must still round-trip losslessly (R19), so the
 * envelope never refuses to hold props it cannot validate.
 *
 * `responsive` carries this same block's per-breakpoint overrides
 * (Slice 2). It defaults to `{}` rather than being optional so a
 * round-tripped document always has the key present — export → import →
 * export stays byte-identical (R8) whether or not a block has any override.
 *
 * `position` (ADR-0014, KAN-1129) is the free-positioning geometry — visual
 * x/y/w/h/rotate/opacity — for a root-level block on a page whose
 * `layoutMode` is `"free"`. It is genuinely optional at this schema layer
 * (a "flow" page's blocks never carry it, and nested/non-root blocks are
 * out of the ADR's scope entirely); `validatePageDocument`
 * (packages/schema/src/validate.ts) is what enforces the ADR's actual rule
 * — required iff (page is "free" AND block.parent === null), rejected
 * otherwise — since that rule needs the *page's* `layoutMode`, which this
 * block-level schema has no visibility into on its own.
 *
 * `scrollReveal` (ADR-0015, KAN-1152) is a per-block opt-in for a
 * scroll-triggered reveal animation on the published site. Shaped like
 * `position` above, not like `responsive`: genuinely `.optional()` rather
 * than `.default(...)`, deliberately, because `responsive`'s own default
 * shipped back when *every* stored `BlockNode` fixture in the codebase
 * still needed updating for it — doing the same here would mean every
 * existing block literal across the repo (tests, seed data,
 * packages/db's row mapper) gains a newly-*required* field it has no
 * reason to care about, which is exactly the non-additive ripple this
 * slice is supposed to avoid. `.optional()` keeps every caller that never
 * mentions `scrollReveal` compiling and behaving unchanged — reading it as
 * `scrollReveal === true` (or `?? false`) at every render call site is the
 * cost of that choice, paid once. Never needs a version bump or migration
 * either way — it's a new optional field, full stop (docs/BLOCK_CONTRACT.md's
 * Versioning section).
 */
export const BlockNodeSchema = z.object({
  id: UlidSchema,
  type: z.string().min(1),
  parent: UlidSchema.nullable(),
  order: z.number().finite(),
  schemaVersion: z.number().int().nonnegative(),
  props: z.record(z.string(), z.unknown()),
  responsive: BlockResponsiveSchema.default({}),
  position: FreePositionSchema.optional(),
  scrollReveal: z.boolean().optional(),
});

export type BlockNode = z.infer<typeof BlockNodeSchema>;

export const BlockListSchema = z.array(BlockNodeSchema);
