import { describe, expect, it } from "vitest";
import type { ThemeTokens } from "@prefab/schema";
import { cssVar, resolveThemeTokens, themeRootStyle, themeTokensToStyleVars } from "../src/theme-css.js";

const EMPTY_TOKENS: ThemeTokens = { color: {}, fontSize: {}, spacing: {}, radius: {}, fontFamily: {} };

describe("cssVar", () => {
  it("builds a bare var() reference — no literal fallback baked into the block (invariant 2)", () => {
    expect(cssVar("color", "accent")).toBe("var(--pf-color-accent)");
  });
});

describe("resolveThemeTokens", () => {
  it("fills in a token the theme is missing from the given defaults", () => {
    const resolved = resolveThemeTokens(EMPTY_TOKENS, { color: { accent: "#4f46e5" }, fontSize: {}, spacing: {}, radius: {}, fontFamily: {} });
    expect(resolved.color.accent).toBe("#4f46e5");
  });

  it("lets a theme's own value win over the default for the same key", () => {
    const resolved = resolveThemeTokens(
      { color: { accent: "#ff0000" }, fontSize: {}, spacing: {}, radius: {}, fontFamily: {} },
      { color: { accent: "#4f46e5" }, fontSize: {}, spacing: {}, radius: {}, fontFamily: {} },
    );
    expect(resolved.color.accent).toBe("#ff0000");
  });

  it("defaults to the platform's DEFAULT_THEME_TOKENS, so every var() a first-party block emits resolves", () => {
    const resolved = resolveThemeTokens(EMPTY_TOKENS);
    const vars = themeTokensToStyleVars(resolved);
    expect(vars["--pf-color-accent"]).toBeDefined();
    expect(vars["--pf-color-background"]).toBeDefined();
    expect(vars["--pf-fontSize-heading"]).toBeDefined();
    expect(vars["--pf-fontFamily-heading"]).toBeDefined();
  });
});

describe("themeRootStyle", () => {
  it("sets an actual background/color on the root, not just the --pf-* custom properties", () => {
    const style = themeRootStyle(resolveThemeTokens(EMPTY_TOKENS));
    // A block that never sets its own background (Heading, RichText,
    // ContactDetails, Faq, Spacer) must still land on the theme's colors,
    // not the browser's black-on-white default — this is the root the
    // Puck canvas and the published <body> both apply (ADR-0004 WYSIWYG).
    expect(style.background).toBe("var(--pf-color-background)");
    expect(style.color).toBe("var(--pf-color-foreground)");
    expect(style.fontFamily).toBe("var(--pf-fontFamily-body)");
    expect(style["--pf-color-background"]).toBeDefined();
  });
});
