import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "playwright";

/**
 * Shared axe-core mechanics (KAN-1219) — split out of budgets.ts so the
 * template Lighthouse+axe pass (checkTemplateBudget) and the editor's own
 * axe pass (e2e/tests/accessibility.spec.ts) share exactly one source of
 * truth for "what counts as a blocking axe violation" (R6), rather than
 * two copies that could quietly drift apart.
 */

const require = createRequire(import.meta.url);

/** A static axe-core snippet with no dependency on whatever page/server it's injected into. */
export const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

export interface AxeViolation {
  id: string;
  impact: string | null;
  nodes: number;
}

/**
 * R6 has two distinct clauses: every first-party block must have zero
 * *critical* axe-core violations, and every shipped template must
 * separately meet WCAG 2.2 AA contrast — so `color-contrast` blocks
 * regardless of the impact axe assigns it (usually "serious", not
 * "critical"), while every other rule only blocks at "critical". Pure, so
 * it's unit-testable without a browser.
 */
export function classifyBlockingAxeViolations(violations: AxeViolation[]): AxeViolation[] {
  return violations.filter((v) => v.impact === "critical" || v.id === "color-contrast");
}

/** Injects the axe-core snippet into `page` and runs it, returning the normalized violation list. */
export async function runAxe(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = await page.evaluate(async () => {
    return (window as unknown as { axe: { run(): Promise<{ violations: AxeViolation[] }> } }).axe.run();
  });
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: (v as unknown as { nodes: unknown[] }).nodes.length,
  }));
}
