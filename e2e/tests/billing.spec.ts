import { test, expect, type Page } from "@playwright/test";
import { ApiClient, ApiClientError } from "@prefab/api-client";
import { API_URL, EDITOR_URL } from "./helpers.js";

// SLICES.md Slice 8 demo: "Sign up free, hit the custom-domain gate,
// upgrade, and the gate opens." Driven at the API-client level (like
// concurrency.spec.ts and offline.spec.ts) rather than through the editor
// UI — Slice 8 adds no new editor screens, only the mutation/gate/role
// surfaces SLICES.md's own test list asks for.

/** Real signup + verify, exactly like signup-flow.spec.ts's browser flow — reading the code back from the same dev-only outbox, but through the API client directly so this test gets a genuinely free-tier account, distinct from the shared, already-upgraded-to-pro seed account every other spec in this suite uses. */
async function signUpFreeAccount(emailPrefix: string): Promise<{ api: ApiClient; email: string }> {
  const email = `${emailPrefix}-${Date.now()}@example.com`;
  const api = new ApiClient({ baseUrl: API_URL });
  await api.signup(email);

  const response = await fetch(`${API_URL}/v1/dev/emails?to=${encodeURIComponent(email)}`);
  const messages = (await response.json()) as Array<{ text: string }>;
  const code = /\b(\d{6})\b/.exec(messages.at(-1)!.text)?.[1];
  expect(code).toBeDefined();
  await api.verifyEmail(email, code!);

  return { api, email };
}

test.describe("accounts, plans and billing (Slice 8, ADR-0005/ADR-0012)", () => {
  test("a free account is blocked from adding a custom domain, upgrades, and succeeds", async () => {
    const { api } = await signUpFreeAccount("billing-gate");
    const site = await api.createSite({ slug: `billing-gate-${Date.now()}`, name: "Billing Gate" });

    let caught: unknown;
    try {
      await api.addDomain(site.site.id, `www.billing-gate-${Date.now()}.example`);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiClientError);
    expect((caught as ApiClientError).code).toBe("plan_required");

    const upgrade = await api.upgradePlan();
    expect(upgrade.subscription.plan).toBe("free");
    expect(upgrade.checkout).not.toBeNull();

    // Simulate Stripe checkout completing — the same dev-only fake-Stripe
    // route custom-domains.spec.ts's equivalent (FakeDomainProvider's
    // advance endpoint) uses for DNS propagation.
    const advance = await fetch(`${API_URL}/v1/dev/stripe/${upgrade.subscription.accountId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "checkout_completed" }),
    });
    expect(advance.ok).toBe(true);

    const domain = await api.addDomain(site.site.id, `www.billing-gate-${Date.now()}.example`);
    expect(domain.domain.status).toBe("pending_dns");
  });

  test("a failed payment moves the account to a grace state without taking sites down immediately", async () => {
    const { api } = await signUpFreeAccount("billing-dunning");
    const upgrade = await api.upgradePlan();
    const accountId = upgrade.subscription.accountId;
    await fetch(`${API_URL}/v1/dev/stripe/${accountId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "checkout_completed" }),
    });
    const site = await api.createSite({ slug: `billing-dunning-${Date.now()}`, name: "Billing Dunning" });

    const failedResponse = await fetch(`${API_URL}/v1/dev/stripe/${accountId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "payment_failed" }),
    });
    const failed = (await failedResponse.json()) as { subscription: { status: string; gracePeriodEndsAt: string | null } };
    expect(failed.subscription.status).toBe("past_due");
    expect(failed.subscription.gracePeriodEndsAt).not.toBeNull();

    // Grace state, not immediate takedown: custom domains (and by
    // extension everything else) keep working.
    const domain = await api.addDomain(site.site.id, `www.billing-dunning-${Date.now()}.example`);
    expect(domain.domain.status).toBe("pending_dns");

    const recoveredResponse = await fetch(`${API_URL}/v1/dev/stripe/${accountId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "payment_succeeded" }),
    });
    const recovered = (await recoveredResponse.json()) as { subscription: { status: string } };
    expect(recovered.subscription.status).toBe("active");
  });

  test("cancelling starts the 30-day retention window, and export keeps working inside it (R7)", async () => {
    const { api } = await signUpFreeAccount("billing-cancel");
    const upgrade = await api.upgradePlan();
    const accountId = upgrade.subscription.accountId;
    await fetch(`${API_URL}/v1/dev/stripe/${accountId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "checkout_completed" }),
    });
    const site = await api.createSite({ slug: `billing-cancel-${Date.now()}`, name: "Billing Cancel" });

    const canceled = await api.cancelPlan();
    expect(canceled.status).toBe("canceled");
    expect(canceled.retentionEndsAt).not.toBeNull();
    expect(new Date(canceled.retentionEndsAt!).getTime()).toBeGreaterThan(Date.now());

    // R7: export is never gated, ever, on any tier, including a
    // cancelled one inside its retention window — the same read path
    // `prefab pull`/`prefab export` use.
    const pages = await api.listPages(site.site.id);
    expect(pages.length).toBeGreaterThan(0);
    const theme = await api.getTheme(site.site.id);
    expect(theme).toBeTruthy();

    // The gate is closed again the instant it's cancelled — no grace for a new purchase.
    let caught: unknown;
    try {
      await api.addDomain(site.site.id, `www.billing-cancel-${Date.now()}.example`);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiClientError);
    expect((caught as ApiClientError).code).toBe("plan_required");
  });
});

// KAN-1267: the API-level tests above already covered the underlying
// plan_required gate and Stripe lifecycle; the editor had no UI for any of
// it — DomainsPanel rendered the gate's message as plain red text with no
// way forward, and there was no billing/plan screen anywhere to upgrade or
// cancel from. These tests drive the same flows through the browser
// instead, checking the UI this ticket added: the actionable "Upgrade to
// Pro" button on the domain gate, the new Billing panel, and the
// retention message after cancelling (KAN-1268).
//
// Deliberately a fresh, browser-signed-up account (signup-flow.spec.ts's
// own pattern) rather than `loginInBrowser`'s shared seed account — every
// other spec in this suite uses that seed account specifically because
// it's already upgraded to pro, which is exactly the state this gate never
// triggers for.
async function signUpFreeAccountInBrowser(page: Page): Promise<void> {
  const email = `billing-ui-${Date.now()}@example.com`;
  await page.goto(EDITOR_URL);
  await page.getByRole("button", { name: /first time\? create an account/i }).click();
  await page.getByLabel(/email address/i).fill(email);
  await page.getByRole("button", { name: /send me a code/i }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 10_000 });

  const response = await fetch(`${API_URL}/v1/dev/emails?to=${encodeURIComponent(email)}`);
  const messages = (await response.json()) as Array<{ text: string }>;
  const code = /\b(\d{6})\b/.exec(messages.at(-1)!.text)?.[1];
  if (!code) throw new Error("no verification code found in the dev email outbox");

  await page.getByLabel(/verification code/i).fill(code);
  await page.getByRole("button", { name: /verify and continue/i }).click();
  await page.waitForSelector("text=Your sites", { timeout: 15_000 });
}

/** The "Or start blank" form on SitePicker — every blank site gets a seeded home page (apps/api's site.create), so the full editor toolbar (Domains, Billing, …) is reachable immediately, with no publish needed for this suite's purposes. */
async function createBlankSiteAndOpen(page: Page, name: string): Promise<void> {
  const slug = `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
  await page.getByLabel(/^slug$/i).fill(slug);
  await page.getByLabel(/^name$/i).fill(name);
  await page.getByRole("button", { name: /^create site$/i }).click();
  await page.getByRole("button", { name: /^publish$/i }).waitFor({ timeout: 15_000 });
}

async function sessionCookieHeader(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name === "prefab_session");
  if (!cookie) throw new Error("no session cookie found — is the browser logged in?");
  return `${cookie.name}=${cookie.value}`;
}

test.describe("editor billing UI (KAN-1267)", () => {
  test("the domain gate's error is actionable, and upgrading through the Billing panel unblocks it", async ({ page, request }) => {
    await signUpFreeAccountInBrowser(page);
    await createBlankSiteAndOpen(page, `Billing UI ${Date.now()}`);

    await page.getByRole("button", { name: /^domains$/i }).click();
    await expect(page.getByRole("dialog", { name: /custom domains/i })).toBeVisible();

    const hostname = `www.billing-ui-${Date.now()}.test`;
    await page.getByRole("textbox", { name: /^domain$/i }).fill(hostname);
    await page.getByRole("button", { name: /^add domain$/i }).click();

    // The gate error itself, plus the actionable button — not just the
    // plain red text every other DomainsPanel error still gets.
    await expect(page.getByText(/upgrade to add one/i)).toBeVisible({ timeout: 10_000 });
    const gateUpgradeButton = page.getByRole("button", { name: /^upgrade to pro$/i });
    await expect(gateUpgradeButton).toBeVisible();

    await gateUpgradeButton.click();
    await expect(page.getByRole("dialog", { name: /^billing$/i })).toBeVisible();
    await expect(page.getByText(/^free plan$/i)).toBeVisible();

    await page.getByRole("button", { name: /^upgrade to pro$/i }).click();
    await expect(page.getByRole("link", { name: /continue to stripe checkout/i })).toBeVisible({ timeout: 10_000 });

    // Simulate Stripe checkout completing — same dev-only fake-Stripe route
    // the API-level tests above drive directly (FakeStripeProvider has no
    // real hosted checkout page to actually complete).
    const cookie = await sessionCookieHeader(page);
    const subscriptionResponse = await request.get(`${API_URL}/v1/account/subscription`, { headers: { cookie } });
    const { accountId } = (await subscriptionResponse.json()) as { accountId: string };
    const advance = await request.post(`${API_URL}/v1/dev/stripe/${accountId}/advance`, { data: { event: "checkout_completed" } });
    expect(advance.ok()).toBe(true);

    // Close and reopen the panel to pick up the now-active plan.
    await page.getByRole("button", { name: /close billing panel/i }).click();
    await page.getByRole("button", { name: /^billing$/i }).click();
    await expect(page.getByText(/^pro plan$/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^cancel plan$/i })).toBeVisible();
    await page.getByRole("button", { name: /close billing panel/i }).click();

    // The gate is open now.
    await page.getByRole("button", { name: /^domains$/i }).click();
    await page.getByRole("textbox", { name: /^domain$/i }).fill(hostname);
    await page.getByRole("button", { name: /^add domain$/i }).click();
    await expect(page.getByText("Pending DNS")).toBeVisible({ timeout: 10_000 });
  });

  test("cancelling from the Billing panel shows the retention/export message (KAN-1268)", async ({ page, request }) => {
    await signUpFreeAccountInBrowser(page);
    await createBlankSiteAndOpen(page, `Billing Cancel UI ${Date.now()}`);

    const cookie = await sessionCookieHeader(page);
    const subscriptionResponse = await request.get(`${API_URL}/v1/account/subscription`, { headers: { cookie } });
    const { accountId } = (await subscriptionResponse.json()) as { accountId: string };
    await request.post(`${API_URL}/v1/dev/stripe/${accountId}/advance`, { data: { event: "checkout_completed" } });

    await page.getByRole("button", { name: /^billing$/i }).click();
    await expect(page.getByRole("dialog", { name: /^billing$/i })).toBeVisible();
    await expect(page.getByText(/^pro plan$/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^cancel plan$/i }).click();
    await expect(page.getByText(/subscription canceled/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/guaranteed until/i)).toBeVisible();
  });
});
