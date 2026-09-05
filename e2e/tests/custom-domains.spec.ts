import { test, expect } from "@playwright/test";
import { API_URL, loginInBrowser } from "./helpers.js";

interface DomainListEntry {
  domain: { id: string; hostname: string; status: string; providerHostnameId: string };
}

async function sessionCookieHeader(page: import("@playwright/test").Page): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name === "prefab_session");
  if (!cookie) throw new Error("no session cookie found — is the browser logged in?");
  return `${cookie.name}=${cookie.value}`;
}

/** Creates, opens and publishes a site — every domain test below eventually checks host-based routing, which only ever serves a site that has gone live at least once. Returns the site's slug. */
async function createSiteAndOpen(page: import("@playwright/test").Page, name: string): Promise<string> {
  const slug = `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
  await page.getByLabel(/^slug$/i).fill(slug);
  await page.getByLabel(/^name$/i).fill(name);
  await page.getByRole("button", { name: /^create site$/i }).click();
  const header = page.locator("header").first();
  await expect(header).toContainText(name, { timeout: 15_000 });
  await header.getByRole("button", { name: /^publish$/i }).click();
  await expect(header).toContainText("Live", { timeout: 15_000 });
  // Dismiss the first-publish celebration modal (Slice 3) so it doesn't sit on top of the Domains button.
  const keepEditing = page.getByRole("button", { name: /keep editing/i });
  if (await keepEditing.isVisible().catch(() => false)) await keepEditing.click();
  return slug;
}

async function domainsFor(request: import("@playwright/test").APIRequestContext, cookie: string, siteId: string): Promise<DomainListEntry[]> {
  const response = await request.get(`${API_URL}/v1/sites/${siteId}/domains`, { headers: { cookie } });
  return response.json();
}

async function currentSiteId(request: import("@playwright/test").APIRequestContext, cookie: string, siteName: string): Promise<string> {
  const response = await request.get(`${API_URL}/v1/sites`, { headers: { cookie } });
  const sites = (await response.json()) as Array<{ id: string; name: string }>;
  const site = sites.find((s) => s.name === siteName);
  if (!site) throw new Error(`site "${siteName}" not found`);
  return site.id;
}

// SLICES.md Slice 4: "Point your own domain at a pre-fab site and it serves
// over HTTPS with a valid certificate, with a DNS walkthrough that a
// non-technical owner can follow." No real Cloudflare account or domain
// exists yet, so this drives the FakeDomainProvider through its dev-only
// advance endpoint (apps/api's "/v1/dev/domains/:id/advance") the same way
// signup-flow.spec.ts reads a verification code from the dev-only email
// outbox — the acceptance criteria are exercised end to end against a real
// HTTP server and real Postgres, just not real DNS or a real cert authority.
test("adding a domain shows DNS instructions, and the domain serves the site once DNS/cert verification completes", async ({
  page,
  request,
}) => {
  await loginInBrowser(page);
  const siteName = `Domains ${Date.now()}`;
  await createSiteAndOpen(page, siteName);

  await page.getByRole("button", { name: /^domains$/i }).click();
  await expect(page.getByRole("dialog", { name: /custom domains/i })).toBeVisible();

  const hostname = `www.e2e-domain-${Date.now()}.test`;
  await page.getByRole("textbox", { name: /^domain$/i }).fill(hostname);
  await page.getByRole("button", { name: /^add domain$/i }).click();

  await expect(page.getByText(hostname)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Pending DNS")).toBeVisible();
  // The DNS walkthrough (SLICES.md): a concrete record to add, in plain English.
  await expect(page.getByText(/add a cname record/i).first()).toBeVisible();
  await expect(page.getByText("customer-domains.prefab.local").first()).toBeVisible();

  const cookie = await sessionCookieHeader(page);
  const siteId = await currentSiteId(request, cookie, siteName);
  const domains = await domainsFor(request, cookie, siteId);
  const added = domains.find((d) => d.domain.hostname === hostname);
  expect(added).toBeDefined();

  // Not active yet — the API's own host-based routing must not serve it.
  const beforeActive = await request.get(`${API_URL}/`, { headers: { host: hostname } });
  expect(beforeActive.status()).toBe(404);

  // Simulate DNS propagation completing and the certificate issuing.
  const advance = await request.post(`${API_URL}/v1/dev/domains/${added!.domain.providerHostnameId}/advance`, {
    data: { status: "active" },
  });
  expect(advance.ok()).toBe(true);

  await page.getByRole("button", { name: /check now/i }).click();
  await expect(page.getByText("Active")).toBeVisible({ timeout: 10_000 });

  const afterActive = await request.get(`${API_URL}/`, { headers: { host: hostname } });
  expect(afterActive.status()).toBe(200);
  expect(await afterActive.text()).toContain(siteName);
});

test("a failed DNS/certificate check shows a specific, actionable error, not a generic failure", async ({ page, request }) => {
  await loginInBrowser(page);
  const siteName = `Domain Fail ${Date.now()}`;
  await createSiteAndOpen(page, siteName);

  await page.getByRole("button", { name: /^domains$/i }).click();
  const hostname = `www.e2e-domain-fail-${Date.now()}.test`;
  await page.getByRole("textbox", { name: /^domain$/i }).fill(hostname);
  await page.getByRole("button", { name: /^add domain$/i }).click();
  await expect(page.getByText(hostname)).toBeVisible({ timeout: 10_000 });

  const cookie = await sessionCookieHeader(page);
  const siteId = await currentSiteId(request, cookie, siteName);
  const domains = await domainsFor(request, cookie, siteId);
  const added = domains.find((d) => d.domain.hostname === hostname)!;

  await request.post(`${API_URL}/v1/dev/domains/${added.domain.providerHostnameId}/advance`, {
    data: { status: "failed", verificationErrors: ["CNAME record not found — DNS may still be propagating"] },
  });

  await page.getByRole("button", { name: /check now/i }).click();
  await expect(page.getByText("Failed")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/cname record not found/i)).toBeVisible();
});

test("removing a domain stops serving it immediately", async ({ page, request }) => {
  await loginInBrowser(page);
  const siteName = `Domain Remove ${Date.now()}`;
  await createSiteAndOpen(page, siteName);

  await page.getByRole("button", { name: /^domains$/i }).click();
  const hostname = `www.e2e-domain-remove-${Date.now()}.test`;
  await page.getByRole("textbox", { name: /^domain$/i }).fill(hostname);
  await page.getByRole("button", { name: /^add domain$/i }).click();
  await expect(page.getByText(hostname)).toBeVisible({ timeout: 10_000 });

  const cookie = await sessionCookieHeader(page);
  const siteId = await currentSiteId(request, cookie, siteName);
  const domains = await domainsFor(request, cookie, siteId);
  const added = domains.find((d) => d.domain.hostname === hostname)!;
  await request.post(`${API_URL}/v1/dev/domains/${added.domain.providerHostnameId}/advance`, { data: { status: "active" } });
  await page.getByRole("button", { name: /check now/i }).click();
  await expect(page.getByText("Active")).toBeVisible({ timeout: 10_000 });

  const whileActive = await request.get(`${API_URL}/`, { headers: { host: hostname } });
  expect(whileActive.status()).toBe(200);

  await page.getByRole("button", { name: /^remove$/i }).click();
  await expect(page.getByText(hostname)).not.toBeVisible({ timeout: 10_000 });

  const afterRemoval = await request.get(`${API_URL}/`, { headers: { host: hostname } });
  expect(afterRemoval.status()).toBe(404);
});

test("every site is already reachable at <slug>.prefab.local with no domain set up (R1's free hosting)", async ({
  page,
  request,
}) => {
  await loginInBrowser(page);
  const siteName = `Subdomain ${Date.now()}`;
  const slug = await createSiteAndOpen(page, siteName);

  const response = await request.get(`${API_URL}/`, { headers: { host: `${slug}.prefab.local` } });
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain(siteName);
});
