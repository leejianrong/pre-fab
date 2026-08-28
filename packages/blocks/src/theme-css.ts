import { DEFAULT_THEME_TOKENS, type ThemeTokens } from "@prefab/schema";

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
  return vars;
}

export type ThemeTokenGroup = keyof ThemeTokens;

/** The call every block makes instead of writing `var(--pf-<group>-<name>)` by hand. No fallback argument — CLAUDE.md invariant 2 forbids a raw value anywhere in a block, including as a CSS var() fallback, so resolution happens once, centrally, in `resolveThemeTokens` below, not per call site. */
export function cssVar(group: ThemeTokenGroup, name: string): string {
  return `var(--pf-${group}-${name})`;
}

/**
 * A block referencing a token name a given theme doesn't define (an older
 * theme predating a newer block, a hand-edited theme.json missing a key)
 * must still resolve to *something* — but that something has to come from
 * another token, never a literal written into a block file. This merges
 * the platform's own default theme underneath whatever the site's theme
 * defines, group by group, so every var() a first-party block emits is
 * guaranteed to be set by the time `themeTokensToStyleVars` runs. Callers
 * that turn a theme document into page styles (@prefab/puck-adapter's
 * canvas root, @prefab/publish's page template) call this first.
 */
export function resolveThemeTokens(tokens: ThemeTokens, defaults: ThemeTokens = DEFAULT_THEME_TOKENS): ThemeTokens {
  return {
    color: { ...defaults.color, ...tokens.color },
    fontSize: { ...defaults.fontSize, ...tokens.fontSize },
    spacing: { ...defaults.spacing, ...tokens.spacing },
    radius: { ...defaults.radius, ...tokens.radius },
  };
}
