import type { ScannedFile } from "./scan.js";

export interface ContainmentViolation {
  rule: string;
  file: string;
  specifier: string;
}

const ASTRO_SPECIFIER = /^astro(\/|$)|^@astrojs\//;
const PUCK_SPECIFIER = /^@puckeditor\//;
/**
 * Every control-plane workspace package. `@prefab/schema` is deliberately
 * absent — it's pure document-schema/validation with no control-plane
 * dependency of its own, so both sides may import it.
 */
const CONTROL_PLANE_SPECIFIER = /^@prefab\/(db|api-client|commands|templates|blocks|publish|puck-adapter)(\/|$)/;

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

/**
 * ADR-0010's separability commitment, made concrete: a runtime package must
 * never import a control-plane package, because the self-host runtime
 * (Slice 7) reimplements the exact same runtime packages against SQLite —
 * any control-plane import would be something self-host cannot resolve.
 * "A seam only survives if something enforces it" (ADR-0010's own words) —
 * this is that enforcement, run from commit one of Slice 6, not added once
 * something has already leaked across it.
 */
export function checkRuntimeContainment(
  files: ScannedFile[],
  runtimePackages: string[] = ["packages/runtime"],
  forbiddenSpecifier: RegExp = CONTROL_PLANE_SPECIFIER,
): ContainmentViolation[] {
  const violations: ContainmentViolation[] = [];
  for (const file of files) {
    if (!runtimePackages.some((pkg) => isUnder(file.path, pkg))) continue;
    for (const specifier of file.imports) {
      if (forbiddenSpecifier.test(specifier)) {
        violations.push({ rule: "no-control-plane-in-runtime", file: file.path, specifier });
      }
    }
  }
  return violations;
}
