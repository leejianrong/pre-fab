import { z } from "zod";
import { UlidSchema } from "./ids.js";

/**
 * Design tokens only — no block may reference a raw value (CLAUDE.md
 * invariant 2 / ADR-0002). Each group stays a `Record<string, string>`
 * rather than a fixed set of keys: growing the token set (this is Slice
 * 2's full type scale, up from Slice 1's minimal one) is additive, and a
 * block referencing a token the active theme doesn't define resolves
 * through the CSS custom-property fallback in theme-css.ts rather than
 * failing closed.
 */
export const ThemeTokensSchema = z.object({
  color: z.record(z.string(), z.string()),
  fontSize: z.record(z.string(), z.string()),
  spacing: z.record(z.string(), z.string()),
  radius: z.record(z.string(), z.string()),
  /**
   * CSS `font-family` stacks, keyed by role ("heading", "body"). System-font
   * stacks only, deliberately: no @font-face/webfont loading pipeline exists
   * (or is proposed here), so a pairing is guaranteed to render everywhere
   * with no network fetch. `.default({})`, not required, for the same
   * reason `BlockNode.responsive` defaults rather than requires (block.ts):
   * every template's checked-in theme.json predates this group, and this
   * keeps them validating as-is — they fall through to
   * `DEFAULT_THEME_TOKENS.fontFamily` via `resolveThemeTokens` at render
   * time (theme-css.ts) rather than failing closed.
   */
  fontFamily: z.record(z.string(), z.string()).default({}),
  /**
   * KAN-1204 (docs/design-audit-2026-09.md §2): unitless CSS `line-height`
   * ratios, keyed the same way `fontSize` is (`xs`/`sm`/`body`/`lg`/
   * `heading`/`display`) so a block pairs the two by name. Falling through
   * to the browser default (`line-height: normal`, ~1.15–1.2×) is exactly
   * the bug the audit measured — every key here targets ~1.4–1.6× for
   * body-ish sizes and ~1.1–1.25× for heading/display instead. `.default({})`
   * for the same reason `fontFamily` is: every theme document persisted
   * before this group existed (every template's checked-in theme.json,
   * every already-created site's row in Postgres) predates it, and this
   * keeps them validating as-is rather than failing closed — they fall
   * through to `DEFAULT_THEME_TOKENS.lineHeight` via `resolveThemeTokens`
   * at render time (theme-css.ts), and also at the DB-read boundary
   * (packages/db's themes.ts repository now resolves against defaults
   * there too — see that file's comment for why that's needed on top of
   * the render-time fallback).
   */
  lineHeight: z.record(z.string(), z.string()).default({}),
});

export type ThemeTokens = z.infer<typeof ThemeTokensSchema>;

export const ThemeDocumentSchema = z.object({
  id: UlidSchema,
  siteId: UlidSchema,
  schemaVersion: z.number().int().nonnegative(),
  tokens: ThemeTokensSchema,
});

export type ThemeDocument = z.infer<typeof ThemeDocumentSchema>;

/**
 * Slice 2's full token set. Existing keys (background, foreground, accent,
 * accent-foreground, muted, heading, body, section, element, control) are
 * kept byte-identical so Slice 1's Hero block and any site created under
 * it keep resolving the same values — growing the scale is additive, not a
 * breaking rename.
 */
export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  color: {
    background: "#ffffff",
    foreground: "#0f172a",
    surface: "#f8fafc",
    "surface-foreground": "#0f172a",
    border: "#e2e8f0",
    accent: "#4f46e5",
    "accent-foreground": "#ffffff",
    muted: "#64748b",
    "muted-foreground": "#94a3b8",
  },
  fontSize: {
    xs: "0.75rem",
    sm: "0.9375rem",
    body: "1.125rem",
    lg: "1.25rem",
    heading: "clamp(2rem, 4vw, 3.5rem)",
    display: "clamp(2.5rem, 6vw, 4.5rem)",
  },
  spacing: {
    xs: "0.5rem",
    sm: "0.75rem",
    element: "1rem",
    /**
     * KAN-1204 (docs/design-audit-2026-09.md §1): the missing middle rung
     * between `lg` (32px) and `section` (80–96px) — every standalone block
     * that isn't `Hero` had no spacing option in that range, forcing a
     * choice between a cramped 12–32px gap or an 80px+ one. 48px (3rem)
     * stays on the shared 8pt grid every template's own scale already holds
     * to.
     */
    md: "3rem",
    lg: "2rem",
    /**
     * KAN-1204 (docs/design-audit-2026-09.md §1): the page-level horizontal
     * gutter @prefab/publish's page-template.ts now applies, replacing what
     * used to be an incidental, undocumented reliance on the browser's own
     * UA `<body>` margin (8px in Chromium). Deliberately the same value as
     * `element` — every block that already pads itself horizontally
     * (`Nav`, `Hero`, `Footer`, `ContactDetails`, `Testimonial`) already uses
     * `spacing.element` for that, so this establishes the same padding
     * language as a real, theme-controlled page-level default instead of a
     * second, unrelated magic number.
     */
    gutter: "1rem",
    section: "4rem",
  },
  radius: {
    control: "0.5rem",
    card: "0.75rem",
    full: "9999px",
  },
  fontFamily: {
    heading: "system-ui, sans-serif",
    body: "system-ui, sans-serif",
  },
  lineHeight: {
    xs: "1.4",
    sm: "1.5",
    body: "1.6",
    lg: "1.5",
    heading: "1.2",
    display: "1.15",
  },
};

/**
 * A theme document referencing a token name/group its own record doesn't
 * define (an older theme predating a newer group — `fontFamily`, now
 * `lineHeight` — a hand-edited theme.json missing a key) must still resolve
 * to *something*, and that something has to come from another token, never a
 * literal written into a block file (CLAUDE.md invariant 2). This merges the
 * platform's own default theme underneath whatever the given theme defines,
 * group by group, so every var() a first-party block emits is guaranteed to
 * be set.
 *
 * Lives in @prefab/schema rather than @prefab/blocks (where it used to live,
 * and is still re-exported from for every existing block import) because
 * packages/db's themes.ts repository needs it too, at the DB-read boundary —
 * @prefab/db already depends on @prefab/schema for `ThemeTokens` itself, but
 * must never depend on @prefab/blocks (a React/JSX rendering package with no
 * business in a repository layer). Moving this pure, DOM-free function to
 * the package both already share is what makes that possible without
 * duplicating the merge logic in three places.
 */
export function resolveThemeTokens(tokens: ThemeTokens, defaults: ThemeTokens = DEFAULT_THEME_TOKENS): ThemeTokens {
  return {
    color: { ...defaults.color, ...tokens.color },
    fontSize: { ...defaults.fontSize, ...tokens.fontSize },
    spacing: { ...defaults.spacing, ...tokens.spacing },
    radius: { ...defaults.radius, ...tokens.radius },
    fontFamily: { ...defaults.fontFamily, ...tokens.fontFamily },
    lineHeight: { ...defaults.lineHeight, ...tokens.lineHeight },
  };
}
