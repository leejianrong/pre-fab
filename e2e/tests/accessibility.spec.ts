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

  // Audit C3 (2026-09-14): the top app bar's 10+ ungrouped nav buttons plus
  // the layout select, Save and Publish don't wrap or shrink, so their
  // unwrapped min-content width forces the whole document wider than a
  // standard 1440px laptop viewport — a horizontal scrollbar on the one
  // screen the whole product revolves around. `.pf-top-app-bar-actions`
  // now wraps (ui/tokens.css) instead of overflowing; this pins that down
  // at the exact width the audit measured it on.
  test("site editor canvas has no horizontal overflow at 1440px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { site } = await authenticatedContext("overflow-canvas");
    await loginInBrowser(page);
    await openSiteByName(page, site.site.name);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `document.documentElement.scrollWidth (${scrollWidth}) exceeds clientWidth (${clientWidth})`).toBeLessThanOrEqual(clientWidth);
  });

  test("theme editor side sheet", async ({ page }) => {
    const { site } = await authenticatedContext("axe-theme");
    await loginInBrowser(page);
    await openSiteByName(page, site.site.name);
    await page.getByRole("button", { name: /^theme$/i }).click();
    await page.getByRole("complementary", { name: /theme editor/i }).waitFor({ timeout: 10_000 });
    await runAxeOn("theme editor side sheet", page);
  });

  // KAN-1263: the page picker/navigator added to close out "no way to
  // create or navigate between pages in the editor" — same SideSheet
  // pattern as the theme editor above, checked the same way.
  test("pages side sheet", async ({ page }) => {
    const { site } = await authenticatedContext("axe-pages");
    await loginInBrowser(page);
    await openSiteByName(page, site.site.name);
    await page.getByRole("button", { name: /^pages$/i }).click();
    await page.getByRole("complementary", { name: /site pages/i }).waitFor({ timeout: 10_000 });
    await runAxeOn("pages side sheet", page);
  });

  // KAN-1264: the Submissions panel's new webhook secret field + delivery
  // status list — same SideSheet pattern as the pages side sheet above,
  // checked the same way. The seed site here has no Form block, so this
  // exercises the "no Form block yet" empty state (the panel's title stays
  // "Forms" until a form is picked, same as the pages side sheet checking
  // its own default state).
  test("forms/submissions side sheet", async ({ page }) => {
    const { site } = await authenticatedContext("axe-forms");
    await loginInBrowser(page);
    await openSiteByName(page, site.site.name);
    await page.getByRole("button", { name: /^submissions$/i }).click();
    await page.getByRole("complementary", { name: /form submissions/i }).waitFor({ timeout: 10_000 });
    await runAxeOn("forms/submissions side sheet", page);
  });

  // KAN-1265: the new BYO-Stripe connect/disconnect + payment/subscription
  // records panel — same SideSheet pattern as the pages side sheet above,
  // checked the same way. Not-connected state (the "Connect Stripe" form)
  // is the one exercised here, the same way the pages side sheet checks
  // its own default state.
  test("payments side sheet", async ({ page }) => {
    const { site } = await authenticatedContext("axe-payments");
    await loginInBrowser(page);
    await openSiteByName(page, site.site.name);
    await page.getByRole("button", { name: /^payments$/i }).click();
    await page.getByRole("complementary", { name: /^payments$/i }).waitFor({ timeout: 10_000 });
    await runAxeOn("payments side sheet", page);
  });

  // KAN-1257: the new Bookings panel (availability.set/get, booking.list/
  // cancel — Slice 9, ADR-0009) — same SideSheet pattern as the pages side
  // sheet above, checked the same way. The seed site here has no
  // availability rule configured yet, so this exercises the "no
  // availability set" default-form state (all weekly-window rows blank)
  // alongside the (empty) bookings list, same as the pages side sheet
  // checking its own default state.
  test("bookings side sheet", async ({ page }) => {
    const { site } = await authenticatedContext("axe-bookings");
    await loginInBrowser(page);
    await openSiteByName(page, site.site.name);
    await page.getByRole("button", { name: /^bookings$/i }).click();
    await page.getByRole("complementary", { name: /^bookings$/i }).waitFor({ timeout: 10_000 });
    await runAxeOn("bookings side sheet", page);
  });

  // KAN-1267: the new Billing panel (getSubscription/upgradePlan/cancelPlan,
  // ADR-0012) — same SideSheet pattern as the other panels above, checked
  // the same way. The seed account this suite's `authenticatedContext`
  // logs in as is already upgraded to pro (billing.spec.ts's own comment),
  // so the state exercised here is the "Pro plan" / "Cancel plan" one, not
  // the free-plan upgrade form.
  test("billing side sheet", async ({ page }) => {
    const { site } = await authenticatedContext("axe-billing");
    await loginInBrowser(page);
    await openSiteByName(page, site.site.name);
    await page.getByRole("button", { name: /^billing$/i }).click();
    await page.getByRole("complementary", { name: /^billing$/i }).waitFor({ timeout: 10_000 });
    await runAxeOn("billing side sheet", page);
  });
});
