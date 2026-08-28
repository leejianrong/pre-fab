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
    lg: "2rem",
    section: "4rem",
  },
  radius: {
    control: "0.5rem",
    card: "0.75rem",
    full: "9999px",
  },
};
