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
 *
 * KAN-1220 adds `target-size` (WCAG 2.2 SC 2.5.8, touch-target size) to
 * that same "blocks regardless of impact" list, for the same reason
 * `color-contrast` is there: axe-core@4.13.0 ships `target-size` with a
 * fixed `impact: "serious"` (confirmed directly against the pinned
 * version's rule registry, `axe._audit.rules` — never "critical", so
 * `classifyBlockingAxeViolations` would silently let every violation
 * through without this carve-out, the same gap `color-contrast` had
 * before it was special-cased).
 *
 * One important caveat, found by actually running the enabled rule
 * against every shipped template rather than assuming the rule name
 * implies coverage: axe's `target-size` implements WCAG 2.5.8's own
 * "sufficient spacing" exception (a target under 24×24 CSS px is still
 * compliant if a 24px-diameter circle centered on it doesn't reach
 * another focusable target) via a second check, `target-offset`, `any`'d
 * with the size check — so a small-but-isolated or reasonably-gapped
 * target (e.g. Nav/Footer's links before KAN-1220's padding fix, which
 * had `gap: spacing.sm` between them) can legitimately pass "target-size"
 * without ever being ≥24×24 itself. This carve-out doesn't make the rule
 * a no-op: it still fires (and, with this change, blocks) real crowding —
 * e.g. two adjacent small controls with little to no gap between them —
 * confirmed with a synthetic overlapping-buttons fixture during KAN-1220.
 * It just means "target-size passed" is a weaker guarantee than
 * "color-contrast passed": don't read a clean CI run as proof every
 * control is comfortably tap-sized, only that nothing is crowded enough
 * to trip WCAG's own minimum bar.
 */
export function classifyBlockingAxeViolations(violations: AxeViolation[]): AxeViolation[] {
  return violations.filter((v) => v.impact === "critical" || v.id === "color-contrast" || v.id === "target-size");
}

/**
 * Injects the axe-core snippet into `page` and runs it, returning the
 * normalized violation list.
 *
 * `target-size` (WCAG 2.2 SC 2.5.8) ships in axe-core@4.13.0 disabled by
 * default (confirmed directly against `axe._audit.rules` for the pinned
 * version, not assumed from the rule existing) — KAN-1220 turns it on
 * here so it runs for both callers of this function: the template
 * Lighthouse+axe pass (budgets.ts) and the editor's own accessibility
 * pass (e2e/tests/accessibility.spec.ts).
 */
export async function runAxe(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = await page.evaluate(async () => {
    return (
      window as unknown as {
        axe: { run(context: Document, options: Record<string, unknown>): Promise<{ violations: AxeViolation[] }> };
      }
    ).axe.run(document, { rules: { "target-size": { enabled: true } } });
  });
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: (v as unknown as { nodes: unknown[] }).nodes.length,
  }));
}
