import { test, expect } from "@playwright/test";
import { ApiClient, ApiClientError } from "@prefab/api-client";
import { API_URL } from "./helpers.js";

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
