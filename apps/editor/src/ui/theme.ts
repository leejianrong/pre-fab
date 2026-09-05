import { Hct, SchemeTonalSpot, argbFromHex, hexFromArgb } from "@material/material-color-utilities";

/**
 * Seed color for the editor's own control-plane chrome (login, dashboard,
 * panels) — NOT the color system for customer-facing site output, which
 * stays on ADR-0002's per-template theme.json tokens. Chosen as the indigo
 * already used ad hoc as this UI's sole accent before this change
 * (LoginScreen.tsx et al's #4f46e5), not Material's baseline demo purple
 * (#6750a4) — see the material-design-3 skill's "choosing a seed color".
 */
const SEED_COLOR = "#4F46E5";

// DynamicScheme (material-color-utilities) exposes every M3 color role as a
// same-named getter — camelCase here, kebab-cased below to build the
// --md-sys-color-<role> custom property @material/web's compiled
// components already read internally.
const ROLES = [
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "primaryFixed",
  "primaryFixedDim",
  "onPrimaryFixed",
  "onPrimaryFixedVariant",
  "inversePrimary",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "secondaryFixed",
  "secondaryFixedDim",
  "onSecondaryFixed",
  "onSecondaryFixedVariant",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "tertiaryFixed",
  "tertiaryFixedDim",
  "onTertiaryFixed",
  "onTertiaryFixedVariant",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
  "background",
  "onBackground",
  "surface",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "surfaceDim",
  "surfaceBright",
  "surfaceContainerLowest",
  "surfaceContainerLow",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
  "surfaceTint",
  "inverseSurface",
  "inverseOnSurface",
  "outline",
  "outlineVariant",
  "scrim",
  "shadow",
] as const;

type RoleName = (typeof ROLES)[number];
type SchemeLike = Record<RoleName, number>;

function toKebab(role: string): string {
  return role.replace(/([A-Z])/g, "-$1").toLowerCase();
}

function schemeToCssBlock(scheme: SchemeLike): string {
  return ROLES.map((role) => `  --md-sys-color-${toKebab(role)}: ${hexFromArgb(scheme[role])};`).join("\n");
}

let injected = false;

/**
 * Generates the full M3 light + dark role scheme from SEED_COLOR (M3's
 * "Tonal Spot" variant, the default Material You algorithm) and injects
 * both as CSS custom properties — light at :root, dark swapped in as one
 * block under prefers-color-scheme (material-design-3 skill: "don't
 * hand-darken individual roles"). Idempotent so React StrictMode's
 * double-invoke in dev doesn't inject the block twice.
 */
export function injectMaterialTheme(seedHex: string = SEED_COLOR): void {
  if (injected) return;
  injected = true;

  const sourceHct = Hct.fromInt(argbFromHex(seedHex));
  const light = new SchemeTonalSpot(sourceHct, false, 0) as unknown as SchemeLike;
  const dark = new SchemeTonalSpot(sourceHct, true, 0) as unknown as SchemeLike;

  const style = document.createElement("style");
  style.setAttribute("data-prefab-md3-theme", "");
  style.textContent = `:root {\n${schemeToCssBlock(light)}\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n${schemeToCssBlock(dark)}\n  }\n}\n`;
  document.head.appendChild(style);
}
