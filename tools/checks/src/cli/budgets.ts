import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkAllTemplateBudgets } from "../budgets.js";

const bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-template-budgets-"));

let failed = false;
try {
  const results = await checkAllTemplateBudgets(bundleStoreDir);

  for (const result of results) {
    if (result.passed) {
      console.log(`✓ ${result.templateId}: Lighthouse performance ${result.performanceScore}, 0 critical axe-core violations`);
    } else {
      failed = true;
      console.error(`✗ ${result.templateId}:`);
      for (const reason of result.reasons) console.error(`    ${reason}`);
      const nonCritical = result.axeViolations.filter((v) => v.impact !== "critical");
      if (nonCritical.length > 0) {
        console.error(`    (non-blocking axe-core findings: ${nonCritical.map((v) => `${v.id} [${v.impact}]`).join(", ")})`);
      }
    }
  }

  if (!failed) {
    console.log(`✓ R3/R6 template budgets: all ${results.length} templates pass Lighthouse ≥ 90 and zero critical axe-core violations`);
  }
} finally {
  await rm(bundleStoreDir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
