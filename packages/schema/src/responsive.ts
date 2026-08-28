import { z } from "zod";

/**
 * Three breakpoints, no free-form positioning (SLICES.md Slice 2,
 * [ASSUMED]). `base` is the mobile-first default every block already
 * renders — it has no override slot of its own, because "override the
 * default" and "the default" would otherwise be two ways to say the same
 * thing. `md` and `lg` are min-width breakpoints that cascade like CSS:
 * an `lg` viewport also has `md`'s overrides applied unless `lg` names the
 * same field again, in which case `lg` wins (see resolveResponsiveOverride).
 */
export const BREAKPOINTS = ["md", "lg"] as const;
export type OverridableBreakpoint = (typeof BREAKPOINTS)[number];
export type Breakpoint = "base" | OverridableBreakpoint;

export const BREAKPOINT_MIN_WIDTH: Record<OverridableBreakpoint, string> = {
  md: "640px",
  lg: "1024px",
};

/**
 * Deliberately generic rather than per-block-field: exposing every block's
 * every prop as independently overridable per breakpoint would need a
 * bespoke responsive-CSS path per block. These three are the layout-level
 * knobs every block honours uniformly (packages/blocks/src/responsive.tsx),
 * which is enough to satisfy "renders correctly at all three breakpoints"
 * for grid-shaped blocks (columns per row) as well as simple ones
 * (hide/space) without a schema change per new field a block adds.
 */
export const ResponsiveOverrideSchema = z
  .object({
    hidden: z.boolean().optional(),
    spacing: z.enum(["xs", "sm", "element", "lg", "section"]).optional(),
    columns: z.number().int().min(1).max(6).optional(),
  })
  .strict();

export type ResponsiveOverride = z.infer<typeof ResponsiveOverrideSchema>;

export const BlockResponsiveSchema = z
  .object({
    md: ResponsiveOverrideSchema.optional(),
    lg: ResponsiveOverrideSchema.optional(),
  })
  .strict();

export type BlockResponsive = z.infer<typeof BlockResponsiveSchema>;

export const EMPTY_RESPONSIVE: BlockResponsive = {};

/**
 * Mobile-first cascade, matching how the emitted `@media (min-width: ...)`
 * rules actually stack in CSS: resolving for `lg` starts from `md`'s
 * overrides (an `lg` viewport is also a `md` viewport) and then lets `lg`
 * win field-by-field. This is the function the "per-breakpoint override
 * precedence" unit test exercises directly, so the CSS and the pure
 * function can never silently disagree about which value wins.
 */
export function resolveResponsiveOverride(responsive: BlockResponsive, breakpoint: Breakpoint): ResponsiveOverride {
  if (breakpoint === "base") return {};
  if (breakpoint === "md") return { ...responsive.md };
  return { ...responsive.md, ...responsive.lg };
}
