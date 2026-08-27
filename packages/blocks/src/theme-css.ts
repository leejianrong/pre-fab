import type { ThemeTokens } from "@prefab/schema";

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
