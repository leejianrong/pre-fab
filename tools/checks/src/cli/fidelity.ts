import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkFidelity, MAX_DIFF_PERCENT } from "../fidelity.js";

const workDir = await mkdtemp(path.join(tmpdir(), "pf-fidelity-"));

let failed = false;
try {
  const results = await checkFidelity(workDir);

  for (const result of results) {
    if (result.passed) {
      console.log(`✓ ${result.blockType}: ${result.diffPercent.toFixed(4)}% pixel delta`);
    } else {
      failed = true;
      console.error(`✗ ${result.blockType}: ${result.diffPercent.toFixed(4)}% pixel delta > ${MAX_DIFF_PERCENT}% (R9)`);
    }
  }

  if (!failed) {
    console.log(
      `✓ R9 fidelity: all ${results.length} first-party blocks render within ${MAX_DIFF_PERCENT}% pixel delta of the hosted site when ejected`,
    );
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
