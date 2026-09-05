import { z } from "zod";

/**
 * ADR-0014: free-positioning layout, scoped to the page canvas. Percentage-
 * of-canvas geometry, not fixed-canvas pixels — see the ADR's "Rejected"
 * section for why a baseline pixel width was rejected. Bounded fields, not
 * a style bag, the same shape of decision `ResponsiveOverrideSchema`
 * (responsive.ts) already made: this is structural geometry a block knows
 * about itself, not a raw CSS value (invariant 2 is about color/spacing/type
 * coming from theme tokens, not a ban on a block knowing its own width).
 */
export const FreeRectSchema = z.object({
  /** % of canvas width, left edge. */
  x: z.number().min(0).max(100),
  /** % of canvas height, top edge. */
  y: z.number().min(0).max(100),
  /** % of canvas width. */
  w: z.number().min(0).max(100),
  /** % of canvas height. */
  h: z.number().min(0).max(100),
  rotate: z.number().min(-180).max(180).default(0),
  opacity: z.number().min(0).max(1).default(1),
});

export type FreeRect = z.infer<typeof FreeRectSchema>;

/**
 * `base` is the mobile-first rect every "free" block has; `md`/`lg` are the
 * same partial-override cascade `BlockResponsiveSchema` (responsive.ts)
 * already establishes — an `lg` viewport also has `md`'s overrides applied
 * unless `lg` names the same field again.
 */
export const FreePositionSchema = z.object({
  base: FreeRectSchema,
  md: FreeRectSchema.partial().optional(),
  lg: FreeRectSchema.partial().optional(),
});

export type FreePosition = z.infer<typeof FreePositionSchema>;
