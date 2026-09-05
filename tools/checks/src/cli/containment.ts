import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepo } from "../scan.js";
import { checkAstroContainment, checkPuckContainment, checkRuntimeContainment } from "../containment.js";
import { checkSsrSafety } from "../ssr-safety.js";
import { checkNoRawColorsInBlocks } from "../block-contract.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const roots = ["apps", "packages", "tools"].map((d) => path.join(repoRoot, d));

const files = scanRepo(repoRoot, roots);

const astroViolations = checkAstroContainment(files);
const puckViolations = checkPuckContainment(files);
const runtimeViolations = checkRuntimeContainment(files, ["packages/runtime", "apps/self-host"]);
const ssrViolations = checkSsrSafety(files, ["packages/blocks"]);
const rawColorViolations = checkNoRawColorsInBlocks(files);

let failed = false;

if (astroViolations.length > 0) {
  failed = true;
  console.error(`✗ Astro containment (ADR-0007): ${astroViolations.length} violation(s)`);
  for (const v of astroViolations) console.error(`  ${v.file} imports "${v.specifier}"`);
} else {
  console.log("✓ Astro containment: nothing outside packages/publish imports Astro");
}

if (puckViolations.length > 0) {
  failed = true;
  console.error(`✗ Puck containment (ADR-0004): ${puckViolations.length} violation(s)`);
  for (const v of puckViolations) console.error(`  ${v.file} imports "${v.specifier}"`);
} else {
  console.log("✓ Puck containment: packages/blocks stays Puck-free");
}

if (runtimeViolations.length > 0) {
  failed = true;
  console.error(`✗ Runtime separability (ADR-0010): ${runtimeViolations.length} violation(s)`);
  for (const v of runtimeViolations) console.error(`  ${v.file} imports "${v.specifier}"`);
} else {
  console.log("✓ Runtime separability: packages/runtime imports no control-plane package");
}

if (ssrViolations.length > 0) {
  failed = true;
  console.error(`✗ SSR safety (ADR-0004): ${ssrViolations.length} violation(s)`);
  for (const v of ssrViolations) console.error(`  ${v.file}:${v.line} references "${v.identifier}" outside an effect`);
} else {
  console.log("✓ SSR safety: packages/blocks never touches a browser-only global outside an effect");
}

if (rawColorViolations.length > 0) {
  failed = true;
  console.error(`✗ Block contract — no raw colors (ADR-0002, docs/BLOCK_CONTRACT.md): ${rawColorViolations.length} violation(s)`);
  for (const v of rawColorViolations) console.error(`  ${v.file}:${v.line} has a raw color "${v.value}" — use cssVar() instead`);
} else {
  console.log("✓ Block contract: no raw color literal in packages/blocks — every color comes from a theme token");
}

process.exit(failed ? 1 : 0);
