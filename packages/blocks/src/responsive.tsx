import {
  BREAKPOINTS,
  BREAKPOINT_MIN_WIDTH,
  isUlid,
  type BlockResponsive,
  type OverridableBreakpoint,
  type ResponsiveOverride,
} from "@prefab/schema";

/**
 * The rendering half of Slice 2's responsive overrides
 * (@prefab/schema/responsive.ts owns the schema and the pure resolver this
 * mirrors). Every block is automatically responsive by default (intrinsic
 * CSS — clamp() type sizes, flex-wrap, grid auto-fit); this is only the
 * escape hatch for the three fields SLICES.md scopes to (hidden, spacing,
 * columns).
 *
 * Implementation note: a block's own inline `style` (its base, "no
 * override" rendering) always wins specificity against a plain stylesheet
 * rule for the same property, media query or not — inline style has no
 * concept of viewport. `!important` in the generated rule is what makes a
 * breakpoint override actually take effect over the block's inline base
 * style; it's the mechanism here, not a stray escape hatch, so every
 * declaration this module emits carries it.
 */
export interface ResponsiveBlockOptions {
  /** This block's own `display` value when not hidden — 'block' unless the block is a flex/grid container. */
  naturalDisplay?: string;
  /** CSS property that expresses "how many columns" for this block, e.g. 'grid-template-columns'. Omit if the block has no column concept — the `columns` override then has no effect on it. */
  columnsProperty?: string;
}

function declarationsFor(override: ResponsiveOverride, opts: Required<ResponsiveBlockOptions>): string[] {
  const decls: string[] = [];
  if (override.hidden !== undefined) {
    decls.push(`display:${override.hidden ? "none" : opts.naturalDisplay} !important`);
  }
  if (override.spacing) {
    decls.push(`padding:var(--pf-spacing-${override.spacing}) !important`);
  }
  if (override.columns !== undefined && opts.columnsProperty) {
    decls.push(`${opts.columnsProperty}:repeat(${override.columns}, minmax(0, 1fr)) !important`);
  }
  return decls;
}

/**
 * Pure string builder (no React) so the parity/unit-testable core doesn't
 * need a DOM — `ResponsiveStyle` below is a thin wrapper over this.
 * `blockId` is always a validated ULID by the time a block renders (R18),
 * so building the selector by string interpolation carries no injection
 * risk; the same is true of every override value, each constrained by
 * `ResponsiveOverrideSchema` to an enum, a boolean or a bounded integer —
 * never a free-form string.
 */
export function responsiveStyleCss(
  blockId: string,
  responsive: BlockResponsive,
  options: ResponsiveBlockOptions = {},
): string {
  if (!isUlid(blockId)) return "";
  const opts: Required<ResponsiveBlockOptions> = {
    naturalDisplay: options.naturalDisplay ?? "block",
    columnsProperty: options.columnsProperty ?? "",
  };

  let css = "";
  for (const bp of BREAKPOINTS as readonly OverridableBreakpoint[]) {
    const override = responsive[bp];
    if (!override) continue;
    const decls = declarationsFor(override, opts);
    if (decls.length === 0) continue;
    css += `@media (min-width:${BREAKPOINT_MIN_WIDTH[bp]}){[data-pf-block-id="${blockId}"]{${decls.join(";")}}}`;
  }
  return css;
}

/**
 * Every first-party block component accepts these on top of its own typed
 * props. All three are optional: the Puck canvas (packages/puck-adapter)
 * deliberately does not forward any of them — there is no per-breakpoint-
 * override widget in this slice's canvas UI, and scroll-reveal is
 * deliberately published-output-only (ADR-0015) — so a block rendered
 * inside Puck simply renders its unconditional base styling, identical to
 * a plain call with none set. The published page (@prefab/publish) always
 * supplies all three.
 */
export interface BlockRenderProps {
  blockId?: string;
  responsive?: BlockResponsive;
  /** ADR-0015 (KAN-1152): opt-in scroll-triggered reveal. See scroll-reveal.tsx. */
  scrollReveal?: boolean;
}

/**
 * Every first-party block that accepts responsive overrides renders this
 * once, alongside its own markup, with the same `blockId` it sets as
 * `data-pf-block-id` on its root element. Renders nothing when there is
 * nothing to override — the common case — so a page with no overrides
 * anywhere emits no extra markup at all.
 */
export function ResponsiveStyle({
  blockId,
  responsive,
  ...options
}: { blockId: string; responsive: BlockResponsive } & ResponsiveBlockOptions) {
  const css = responsiveStyleCss(blockId, responsive, options);
  if (!css) return null;
  return <style>{css}</style>;
}

/**
 * KAN-1204 (docs/design-audit-2026-09.md §5): a built-in mobile column
 * fallback for grid-shaped blocks (CardGrid, Gallery) — root-caused there as
 * the actual reason 4 of 9 templates overflowed at 375px. Every template
 * hard-codes a fixed `columns` (typically 3) with no per-breakpoint override
 * (`responsive: {}` on every block, in every template), so a card's title
 * text was left with ~77px of usable width at 375px — comfortably narrower
 * than an ordinary 8+ character word.
 *
 * This is deliberately *not* built on the `responsive`-prop mechanism above:
 * that schema's `base` breakpoint (below `md`'s 640px) has no override slot
 * of its own (@prefab/schema/responsive.ts: "base... has no override slot of
 * its own"), so there was previously no way to give the *unconfigured*
 * mobile case a sane default at all — a template or a customer's own card
 * edit would have to opt in to a `responsive.md.columns` override that
 * nothing sets today. Emitting this unconditionally, keyed off the block's
 * own static class name rather than a per-instance `blockId`, is what makes
 * it a real default instead of one more per-template patch: every
 * CardGrid/Gallery instance gets it, authored or not, present blockId or not
 * (the Puck canvas preview, block library tests).
 *
 * `!important` for the same reason every `responsiveStyleCss` declaration
 * needs it (see this module's own doc comment): a block's inline base style
 * (`repeat(columns, minmax(0,1fr))`) always wins specificity over a plain
 * stylesheet rule otherwise. No conflict with an explicit `responsive.md`/
 * `.lg` override: those only ever emit `min-width` rules at 640px/1024px,
 * strictly above this rule's `max-width` range, so the two mechanisms never
 * target the same viewport.
 */
export function intrinsicGridFallbackCss(className: string, minTrackPx: number): string {
  const mobileMaxWidth = Number.parseInt(BREAKPOINT_MIN_WIDTH.md, 10) - 1;
  return `@media (max-width:${mobileMaxWidth}px){.${className}{grid-template-columns:repeat(auto-fit, minmax(${minTrackPx}px, 1fr)) !important;}}`;
}

/** React wrapper over `intrinsicGridFallbackCss` — see that function's doc comment. */
export function IntrinsicGridFallback({ className, minTrackPx }: { className: string; minTrackPx: number }) {
  return <style>{intrinsicGridFallbackCss(className, minTrackPx)}</style>;
}
