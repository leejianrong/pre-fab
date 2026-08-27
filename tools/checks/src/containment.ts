import type { ScannedFile } from "./scan.js";

export interface ContainmentViolation {
  rule: string;
  file: string;
  specifier: string;
}

const ASTRO_SPECIFIER = /^astro(\/|$)|^@astrojs\//;
const PUCK_SPECIFIER = /^@puckeditor\//;

function isUnder(filePath: string, packagePath: string): boolean {
  return filePath === packagePath || filePath.startsWith(`${packagePath}/`);
}

/**
 * ADR-0007 / CLAUDE.md invariant 3: nothing outside the publish pipeline
 * (and, later, the eject generator) imports Astro. Being wrong about Astro
 * should cost a pipeline, not the product — this is the check that keeps
 * that true rather than aspirational.
 */
export function checkAstroContainment(
  files: ScannedFile[],
  allowedPackages: string[] = ["packages/publish"],
): ContainmentViolation[] {
  const violations: ContainmentViolation[] = [];
  for (const file of files) {
    if (allowedPackages.some((pkg) => isUnder(file.path, pkg))) continue;
    for (const specifier of file.imports) {
      if (ASTRO_SPECIFIER.test(specifier)) {
        violations.push({ rule: "no-astro-outside-publish-pipeline", file: file.path, specifier });
      }
    }
  }
  return violations;
}

/**
 * ADR-0004 / CLAUDE.md invariant 3: block components never import Puck
 * context. Puck lives in apps/editor and packages/puck-adapter only —
 * @prefab/blocks itself must stay plain, SSR-safe React.
 */
export function checkPuckContainment(
  files: ScannedFile[],
  blockPackages: string[] = ["packages/blocks"],
): ContainmentViolation[] {
  const violations: ContainmentViolation[] = [];
  for (const file of files) {
    if (!blockPackages.some((pkg) => isUnder(file.path, pkg))) continue;
    for (const specifier of file.imports) {
      if (PUCK_SPECIFIER.test(specifier)) {
        violations.push({ rule: "no-puck-context-in-blocks", file: file.path, specifier });
      }
    }
  }
  return violations;
}
