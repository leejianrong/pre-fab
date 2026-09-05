import { resolveThemeTokens, type ThemeTokens } from "@prefab/schema";

/**
 * Re-exported for every existing block/test import (`from "../theme-css.js"`
 * / `from "./theme-css.js"`) — the implementation itself now lives in
 * @prefab/schema (see that file's own comment on `resolveThemeTokens` for
 * why: packages/db needs it too, at the DB-read boundary, and must never
 * depend on this React/JSX package).
 */
export { resolveThemeTokens };

/**
 * Blocks reference theme tokens, never raw values (CLAUDE.md invariant 2 /
 * ADR-0002). The mechanism: every block styles itself with `var(--pf-*)`
 * custom properties, and this function turns a theme document into the
 * object that sets them — applied as an inline `style` prop, so React
 * escapes it the same way it escapes any other attribute (no string-built
 * `<style>` tag, no injection surface for a theme token value).
 */
export function themeTokensToStyleVars(tokens: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens.color)) {
    vars[`--pf-color-${name}`] = value;
  }
  for (const [name, value] of Object.entries(tokens.fontSize)) {
    vars[`--pf-fontSize-${name}`] = value;
  }
  for (const [name, value] of Object.entries(tokens.spacing)) {
    vars[`--pf-spacing-${name}`] = value;
  }
  for (const [name, value] of Object.entries(tokens.radius)) {
    vars[`--pf-radius-${name}`] = value;
  }
  for (const [name, value] of Object.entries(tokens.fontFamily)) {
    vars[`--pf-fontFamily-${name}`] = value;
  }
  for (const [name, value] of Object.entries(tokens.lineHeight)) {
    vars[`--pf-lineHeight-${name}`] = value;
  }
  return vars;
}

/**
 * The CSS custom properties alone (`themeTokensToStyleVars`) declare every
 * `--pf-*` variable a block might read, but declare nothing about the root
 * element itself — a block that doesn't set its own `background`/`color`
 * (Heading, RichText, ContactDetails, Faq, Spacer) falls through to the
 * browser default (white on black) rather than the theme's own
 * background/foreground pair. This is what both the Puck canvas root
 * (@prefab/puck-adapter's `createPuckConfig`) and the published page's
 * `<body>` (@prefab/publish's page-template.ts) apply, so a themed gap
 * between blocks — and any block that inherits rather than sets its own
 * colors — renders correctly in both places identically (ADR-0004's WYSIWYG
 * guarantee), not just wherever a block happens to declare its own.
 *
 * KAN-1204 (docs/design-audit-2026-09.md §1): `margin: 0` closes the actual
 * root cause of the page's left edge landing at an incidental 8px — the
 * browser's own UA `<body>` margin, "not a design decision, not
 * theme-controlled, not consistent" per the audit. A no-op for the Puck
 * canvas root (already a plain `<div>`, already 0 by default); a real fix
 * for `<body>`, replaced by the explicit, token-driven gutter
 * @prefab/publish's page-template.ts now applies around flow content.
 */
export function themeRootStyle(tokens: ThemeTokens): Record<string, string> {
  return {
    ...themeTokensToStyleVars(tokens),
    background: cssVar("color", "background"),
    color: cssVar("color", "foreground"),
    fontFamily: cssVar("fontFamily", "body"),
    margin: "0",
  };
}

export type ThemeTokenGroup = keyof ThemeTokens;

/** The call every block makes instead of writing `var(--pf-<group>-<name>)` by hand. No fallback argument — CLAUDE.md invariant 2 forbids a raw value anywhere in a block, including as a CSS var() fallback, so resolution happens once, centrally, in `resolveThemeTokens` (@prefab/schema), not per call site. */
export function cssVar(group: ThemeTokenGroup, name: string): string {
  return `var(--pf-${group}-${name})`;
}

/**
 * KAN-1204 (docs/design-audit-2026-09.md §2): the "structural CSS constant
 * that isn't a themeable design decision" carve-out docs/BLOCK_CONTRACT.md
 * already documents (a border width, an em-ratio padding) — a readable prose
 * measure (~45–75 characters/line; this targets the middle of that range)
 * isn't a per-template brand choice the way color/spacing/radius are, so it
 * stays a shared constant here rather than a 7th token group. `ch` is
 * deliberately unitless-relative rather than a `px`/`rem` cap: it scales with
 * whatever `font-size` the element it's applied to actually renders at,
 * which is the whole point of a *measure* constraint (character count per
 * line, not a fixed box width). Used by RichText and PostDetail, the two
 * blocks the audit measured running to ~152 characters/line on desktop with
 * no cap.
 */
export const PROSE_MAX_MEASURE = "65ch";
