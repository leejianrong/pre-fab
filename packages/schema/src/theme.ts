import { z } from "zod";
import { UlidSchema } from "./ids.js";

/**
 * Design tokens only — no block may reference a raw value (CLAUDE.md
 * invariant 2 / ADR-0002). Slice 1 ships the minimal token set the Hero
 * block needs; Slice 2 grows this into a full type scale.
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

export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  color: {
    background: "#ffffff",
    foreground: "#0f172a",
    accent: "#4f46e5",
    "accent-foreground": "#ffffff",
    muted: "#64748b",
  },
  fontSize: {
    heading: "clamp(2rem, 4vw, 3.5rem)",
    body: "1.125rem",
  },
  spacing: {
    section: "4rem",
    element: "1rem",
  },
  radius: {
    control: "0.5rem",
  },
};
