import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { launch as launchChrome, type LaunchedChrome } from "chrome-launcher";
import lighthouse from "lighthouse";
import { buildSiteBundle, servePreview } from "@prefab/publish";
import { TEMPLATE_MANIFESTS, loadTemplateCheckout } from "@prefab/templates/server";
import { newUlid, type SiteManifest, type ThemeDocument } from "@prefab/schema";

/**
 * Per-template Lighthouse + axe-core budgets (SLICES.md Slice 3: "Lighthouse
 * and axe-core budgets in CI, per template", enforcing R3 and R6). Lives
 * alongside containment.ts/parity.ts as its own CI-only check, same reason
 * those two are separate: a budget regression should never be buried in a
 * wall of unit-test output.
 *
 * Builds each template's real Astro output (no DB, no API — the same
 * `buildSiteBundle` apps/api's publish route calls, given the checkout
 * straight from @prefab/templates) and serves it locally, so what's
 * measured is exactly what a visitor would get.
 */

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

// Mirrors e2e/playwright.config.ts's own comment: this sandbox pre-installs
// Chromium at a revision Playwright's resolver doesn't expect; a normal
// machine (including real CI, which runs `playwright install`) has no such
// path and falls through to Playwright's own resolution.
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";

async function resolveChromiumPath(): Promise<string> {
  if (existsSync(PREINSTALLED_CHROMIUM)) return PREINSTALLED_CHROMIUM;
  return chromium.executablePath();
}

export interface AxeViolation {
  id: string;
  impact: string | null;
  nodes: number;
}

export interface TemplateBudgetResult {
  templateId: string;
  performanceScore: number;
  axeViolations: AxeViolation[];
  passed: boolean;
  reasons: string[];
}

const MIN_PERFORMANCE_SCORE = 90;

/** R3: Lighthouse performance must be at least MIN_PERFORMANCE_SCORE. Pure, so it's unit-testable without a browser. */
export function checkPerformanceScore(performanceScore: number): string | null {
  return performanceScore < MIN_PERFORMANCE_SCORE
    ? `Lighthouse performance ${performanceScore} < ${MIN_PERFORMANCE_SCORE} (R3)`
    : null;
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

export async function checkTemplateBudget(templateId: string, bundleStoreDir: string): Promise<TemplateBudgetResult> {
  const checkout = await loadTemplateCheckout(templateId);
  const siteId = newUlid();
  const manifest: SiteManifest = {
    id: siteId,
    slug: templateId,
    name: templateId,
    ownerId: newUlid(),
    schemaVersion: 1,
    pages: checkout.pages.map((p) => ({ id: p.id, slug: p.slug })),
  };
  const theme: ThemeDocument = { id: newUlid(), siteId, schemaVersion: 1, tokens: checkout.theme };

  const built = await buildSiteBundle({ site: manifest, theme, pages: checkout.pages, bundleStoreDir });
  const preview = await servePreview(built.bundlePath);

  const reasons: string[] = [];
  let performanceScore = 0;
  let axeViolations: AxeViolation[] = [];

  try {
    const executablePath = await resolveChromiumPath();

    // Lighthouse — R3: performance >= 90. No custom config passed, so this
    // runs Lighthouse's own default (mobile form factor, simulated
    // slow-4G throttling) — exactly the "simulated 4G" R3 asks for.
    let chrome: LaunchedChrome | undefined;
    try {
      chrome = await launchChrome({
        chromePath: executablePath,
        chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
      });
      const runnerResult = await lighthouse(preview.url, {
        port: chrome.port,
        onlyCategories: ["performance"],
        logLevel: "error",
      });
      performanceScore = Math.round((runnerResult?.lhr.categories.performance?.score ?? 0) * 100);
      const performanceReason = checkPerformanceScore(performanceScore);
      if (performanceReason) reasons.push(performanceReason);
    } finally {
      await chrome?.kill();
    }

    // axe-core — R6: zero critical violations.
    const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.goto(preview.url, { waitUntil: "load" });
      await page.addScriptTag({ content: AXE_SOURCE });
      const results = await page.evaluate(async () => {
        return (window as unknown as { axe: { run(): Promise<{ violations: AxeViolation[] }> } }).axe.run();
      });
      axeViolations = results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: (v as unknown as { nodes: unknown[] }).nodes.length,
      }));
      const blocking = classifyBlockingAxeViolations(axeViolations);
      if (blocking.length > 0) {
        reasons.push(`axe-core found ${blocking.length} blocking violation(s) (R6): ${blocking.map((v) => `${v.id} [${v.impact}]`).join(", ")}`);
      }
    } finally {
      await browser.close();
    }
  } finally {
    await preview.close();
  }

  return { templateId, performanceScore, axeViolations, passed: reasons.length === 0, reasons };
}

export async function checkAllTemplateBudgets(bundleStoreDir: string): Promise<TemplateBudgetResult[]> {
  const results: TemplateBudgetResult[] = [];
  for (const manifest of TEMPLATE_MANIFESTS) {
    results.push(await checkTemplateBudget(manifest.id, bundleStoreDir));
  }
  return results;
}
