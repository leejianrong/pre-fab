import { test, expect } from "@playwright/test";
import { API_URL, loginInBrowser } from "./helpers.js";

async function sessionCookieHeader(page: import("@playwright/test").Page): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name === "prefab_session");
  if (!cookie) throw new Error("no session cookie found — is the browser logged in?");
  return `${cookie.name}=${cookie.value}`;
}

async function currentSiteId(request: import("@playwright/test").APIRequestContext, cookie: string, siteName: string): Promise<string> {
  const response = await request.get(`${API_URL}/v1/sites`, { headers: { cookie } });
  const sites = (await response.json()) as Array<{ id: string; name: string }>;
  const site = sites.find((s) => s.name === siteName);
  if (!site) throw new Error(`site "${siteName}" not found`);
  return site.id;
}

// KAN-1130: the deterministic onboarding wizard picks a template and a
// style preset from two branching questions, forks the template, then
// applies the preset's theme — this exercises the whole path against a
// real API, not just the pure recommend() unit tests.
test("the onboarding wizard forks the recommended template and applies the recommended style", async ({ page, request }) => {
  await loginInBrowser(page);

  await page.getByText("Not sure where to start?").click();
  await page.getByText("Neighbourhood Café", { exact: true }).click();
  await page.getByText("Warm & Welcoming", { exact: true }).click();

  await expect(page.getByText("Recommended:")).toContainText("Neighbourhood Café");
  await expect(page.getByText("Recommended:")).toContainText("Warm & Welcoming");

  const siteName = `Wizard Site ${Date.now()}`;
  await page.getByLabel(/^name$/i).fill(siteName);
  await page.getByRole("button", { name: /^create my site$/i }).click();

  const header = page.locator("header").first();
  await expect(header).toContainText(siteName, { timeout: 15_000 });

  const cookie = await sessionCookieHeader(page);
  const siteId = await currentSiteId(request, cookie, siteName);
  const themeResponse = await request.get(`${API_URL}/v1/sites/${siteId}/theme`, { headers: { cookie } });
  const theme = (await themeResponse.json()) as { tokens: { color: Record<string, string>; fontFamily: Record<string, string> } };

  // The "Warm & Welcoming" preset's own values (packages/templates/src/presets.ts) — asserted
  // literally so a preset edit that silently drifts the applied theme fails this test.
  expect(theme.tokens.color.accent).toBe("#b5502c");
  expect(theme.tokens.fontFamily.heading).toBe("Georgia, 'Times New Roman', serif");
});

test("cancelling the wizard returns to the normal site picker", async ({ page }) => {
  await loginInBrowser(page);

  await page.getByText("Not sure where to start?").click();
  await page.getByRole("button", { name: /^cancel$/i }).click();

  await expect(page.getByText("Or start blank")).toBeVisible();
});
