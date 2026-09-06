import { expect, test, type Page } from "@playwright/test";
import { classifyBlockingAxeViolations, runAxe, type AxeViolation } from "@prefab/ci-checks/axe";
import { EDITOR_URL, authenticatedContext, loginInBrowser, openSiteByName } from "./helpers.js";

/**
 * KAN-1219 — spun off from KAN-1203's design audit (docs/design-audit-2026-09.md
 * section 3): `tools/checks/src/budgets.ts`'s axe-core pass only ever ran
 * against published *templates*, via a static Astro build. `apps/editor/`'s
 * own screens (the MD3 kit shipped for EPIC-151 included) had never been run
 * through an automated accessibility check.
 *
 * Same gate as the template pass, same source of truth
 * (`classifyBlockingAxeViolations`, `@prefab/ci-checks/axe`): a blocking
 * violation is critical impact, or `color-contrast` at any impact (R6). The
 * one real difference from `checkTemplateBudget` — this runs against a live
 * Vite dev-server React SPA, not a finished static build, so each screen's
 * own ready-state selector (the same ones helpers.ts already waits on) is
 * awaited before axe runs, never just `waitUntil: "load"` on its own.
 *
 * apps/editor/src/App.tsx has no router — one URL, four screens reached by
 * conditional state:
 *   - login: the initial state before a session exists (LoginScreen.tsx)
 *   - picker: after login, before a site is opened (SitePicker.tsx, which
 *     also renders TemplateGallery inline)
 *   - editor: a site's canvas (SiteEditor.tsx), signalled by the
 *     `/^publish$/i` button
 *   - the theme editor: not a separate screen, a SideSheet opened from
 *     inside the editor screen (SiteEditor.tsx's "Theme" button)
 */

async function assertNoBlockingViolations(screen: string, violations: AxeViolation[]): Promise<void> {
  const blocking = classifyBlockingAxeViolations(violations);
  if (blocking.length > 0) {
    console.error(`✗ ${screen}:`);
    console.error(
      `    axe-core found ${blocking.length} blocking violation(s) (R6): ${blocking
        .map((v) => `${v.id} [${v.impact}] (${v.nodes} node(s))`)
        .join(", ")}`,
    );
    const nonBlocking = violations.filter((v) => !blocking.includes(v));
    if (nonBlocking.length > 0) {
      console.error(`    (non-blocking axe-core findings: ${nonBlocking.map((v) => `${v.id} [${v.impact}]`).join(", ")})`);
    }
  } else {
    console.log(`✓ ${screen}: 0 blocking axe-core violations (${violations.length} total finding(s))`);
  }
  expect(blocking, `axe-core blocking violation(s) on "${screen}" (R6): ${blocking.map((v) => `${v.id} [${v.impact}]`).join(", ") || "none"}`).toEqual([]);
}

async function runAxeOn(screen: string, page: Page): Promise<void> {
  const violations = await runAxe(page);
  await assertNoBlockingViolations(screen, violations);
}

test.describe("editor UI accessibility (R6, KAN-1219)", () => {
  test("login screen", async ({ page }) => {
    await page.goto(EDITOR_URL);
    await page.getByLabel(/seeded account email/i).waitFor({ timeout: 15_000 });
    await runAxeOn("login screen", page);
  });

  test("template picker screen", async ({ page }) => {
    await loginInBrowser(page);
    await page.getByRole("heading", { name: /start from a template/i }).waitFor({ timeout: 15_000 });
    await runAxeOn("template picker screen", page);
  });

  test("site editor canvas", async ({ page }) => {
    const { site } = await authenticatedContext("axe-canvas");
    await loginInBrowser(page);
    await openSiteByName(page, site.site.name);
    await runAxeOn("site editor canvas", page);
  });

  test("theme editor side sheet", async ({ page }) => {
    const { site } = await authenticatedContext("axe-theme");
    await loginInBrowser(page);
    await openSiteByName(page, site.site.name);
    await page.getByRole("button", { name: /^theme$/i }).click();
    await page.getByRole("dialog", { name: /theme editor/i }).waitFor({ timeout: 10_000 });
    await runAxeOn("theme editor side sheet", page);
  });
});
