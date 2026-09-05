import { DEFAULT_THEME_TOKENS, type ThemeTokens } from "@prefab/schema";

/**
 * KAN-1130's "token preset": a named, curated (palette, font pairing) pair,
 * independent of which template it's applied to — the same separation
 * ADR-0002's theme.json already makes between content structure and design
 * tokens, one level up. System-font stacks only, deliberately: no
 * @font-face/webfont loading pipeline exists (or is proposed here), so a
 * pairing renders identically everywhere with no network fetch — the same
 * "no-silent-magic, deterministic" reasoning KAN-1130 applies to the
 * wizard itself applies here to what it recommends.
 */
export interface StylePreset {
  id: string;
  name: string;
  description: string;
  color: ThemeTokens["color"];
  fontFamily: ThemeTokens["fontFamily"];
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "warm",
    name: "Warm & Welcoming",
    description: "Earthy tones and a friendly serif heading — cafés, tutors, anyone selling a personal touch.",
    color: {
      background: "#fdf6ec",
      foreground: "#3f2a1d",
      surface: "#f6e8d7",
      "surface-foreground": "#3f2a1d",
      border: "#e6d2b8",
      accent: "#b5502c",
      "accent-foreground": "#fdf6ec",
      muted: "#e6d2b8",
      "muted-foreground": "#5c4530",
    },
    fontFamily: {
      heading: "Georgia, 'Times New Roman', serif",
      body: "'Trebuchet MS', 'Segoe UI', sans-serif",
    },
  },
  {
    id: "modern",
    name: "Clean & Modern",
    description: "Neutral grays and a geometric sans — consultants, agencies, anything that should read as efficient.",
    color: {
      background: "#ffffff",
      foreground: "#111827",
      surface: "#f3f4f6",
      "surface-foreground": "#111827",
      border: "#e5e7eb",
      accent: "#2563eb",
      "accent-foreground": "#ffffff",
      muted: "#e5e7eb",
      "muted-foreground": "#4b5563",
    },
    fontFamily: {
      heading: "'Helvetica Neue', Arial, sans-serif",
      body: "'Helvetica Neue', Arial, sans-serif",
    },
  },
  {
    id: "bold",
    name: "Bold & Editorial",
    description: "High contrast and a serif display heading — event pages, personal brands, anything that should feel loud.",
    color: {
      background: "#0f0f0f",
      foreground: "#f5f5f5",
      surface: "#1f1f1f",
      "surface-foreground": "#f5f5f5",
      border: "#3a3a3a",
      accent: "#f5c500",
      "accent-foreground": "#0f0f0f",
      muted: "#3a3a3a",
      "muted-foreground": "#b3b3b3",
    },
    fontFamily: {
      heading: "Georgia, 'Times New Roman', serif",
      body: "'Segoe UI', Arial, sans-serif",
    },
  },
  {
    id: "classic",
    name: "Classic & Professional",
    description: "Traditional serif throughout and a muted navy palette — fitness coaches, photographers, anyone trading on trust.",
    color: {
      background: "#f9f8f6",
      foreground: "#1e2a3a",
      surface: "#eef0f2",
      "surface-foreground": "#1e2a3a",
      border: "#d6dbe1",
      accent: "#1e3a5f",
      "accent-foreground": "#f9f8f6",
      muted: "#d6dbe1",
      "muted-foreground": "#4a5568",
    },
    fontFamily: {
      heading: "'Palatino Linotype', Palatino, Georgia, serif",
      body: "Georgia, 'Times New Roman', serif",
    },
  },
];

export function getStylePreset(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((preset) => preset.id === id);
}

/** Expands a preset's (palette, font pairing) into a complete `ThemeTokens` — `theme.update` (apps/api's existing mutation) takes the whole document, never a patch, so fontSize/spacing/radius come from the platform default underneath. */
export function stylePresetToThemeTokens(preset: StylePreset): ThemeTokens {
  return {
    color: { ...DEFAULT_THEME_TOKENS.color, ...preset.color },
    fontFamily: { ...DEFAULT_THEME_TOKENS.fontFamily, ...preset.fontFamily },
    fontSize: DEFAULT_THEME_TOKENS.fontSize,
    spacing: DEFAULT_THEME_TOKENS.spacing,
    radius: DEFAULT_THEME_TOKENS.radius,
    // KAN-1204: no preset customizes line-height (it isn't a (palette, font
    // pairing) concern the way color/fontFamily are) — every preset inherits
    // the platform default, same as fontSize/spacing/radius above.
    lineHeight: DEFAULT_THEME_TOKENS.lineHeight,
  };
}
