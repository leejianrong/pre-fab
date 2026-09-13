import { test, expect } from "@playwright/test";
import { newUlid } from "@prefab/schema";
import { API_URL, authenticatedContext, loginInBrowser, openSiteByName } from "./helpers.js";

// SLICES.md-style e2e for Slice 10 / KAN-1137 (ADR-0005: bring-your-own
// Stripe, zero platform fee). There is no real Stripe Checkout page to
// click through in this environment (no live Stripe account exists here,
// same constraint as every other third-party integration) — driven at the
// API-client level, the same "dev-advance simulates the webhook" shape
// billing.spec.ts's own use of /v1/dev/stripe/:accountId/advance already
// establishes for Slice 8's *different* Stripe integration. A Payment
// block is injected directly via the page-write API (like bookingBlock()
// in bookings.spec.ts) rather than clicked through Puck — simpler, and
// the Puck canvas wiring itself is covered by packages/puck-adapter's own
// tests, not this suite.

function paymentBlock(id: string, amount = 1500) {
  return {
    id,
    type: "payment",
    parent: null,
    order: 1000,
    schemaVersion: 1,
    props: {
      heading: "Buy the thing",
      description: "One-time purchase.",
      buttonLabel: "Pay now",
      amount,
      currency: "usd",
      successMessage: "Thank you — your payment was received.",
    },
    responsive: {},
  };
}

function sessionIdFromCheckoutUrl(url: string): string {
  return new URL(url).pathname.split("/").pop()!;
}

test.describe("one-off payment blocks, bring-your-own Stripe (Slice 10 / KAN-1137, ADR-0005)", () => {
  test("connect, checkout, dev-advance simulates completion, and the owner sees a completed payment record", async () => {
    const { ctx, site } = await authenticatedContext("payments-happy");
    const blockId = newUlid();

    await ctx.api.writePage(site.site.id, site.page.id, {
      title: site.page.title,
      slug: site.page.slug,
      blocks: [paymentBlock(blockId, 1500)],
      expectedVersion: site.page.version,
    });
    await ctx.api.publish(site.site.id);

    const connected = await ctx.api.connectStripe(site.site.id, { authorizationCode: "fake-authorization-code" });
    expect(connected.status).toBe("connected");
    expect(connected.stripeAccountId).toBeTruthy();

    const status = await ctx.api.getStripeStatus(site.site.id);
    expect(status?.stripeAccountId).toBe(connected.stripeAccountId);

    // The runtime endpoint — unauthenticated, no body — is what the
    // published Payment block's own "Pay now" button calls.
    const checkoutResponse = await fetch(`${API_URL}/v1/runtime/payment-blocks/${blockId}/checkout`, { method: "POST" });
    expect(checkoutResponse.status).toBe(201);
    const { url } = (await checkoutResponse.json()) as { url: string };
    expect(url).toBeTruthy();
    const sessionId = sessionIdFromCheckoutUrl(url);

    // No real Stripe Checkout page to click through — simulate
    // checkout.session.completed the same way billing.spec.ts does for
    // Slice 8's own (different) Stripe integration.
    const advanceResponse = await fetch(`${API_URL}/v1/dev/stripe-connect/${site.site.id}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, buyerEmail: "buyer@example.com" }),
    });
    expect(advanceResponse.status).toBe(200);

    const payments = await ctx.api.listPayments(site.site.id, blockId);
    expect(payments.total).toBe(1);
    expect(payments.records[0]?.status).toBe("completed");
    expect(payments.records[0]?.amount).toBe(1500);
    expect(payments.records[0]?.buyerEmail).toBe("buyer@example.com");
  });

  test("the runtime endpoint 404s for a payment block whose site never connected Stripe", async () => {
    const { ctx, site } = await authenticatedContext("payments-no-connection");
    const blockId = newUlid();

    await ctx.api.writePage(site.site.id, site.page.id, {
      title: site.page.title,
      slug: site.page.slug,
      blocks: [paymentBlock(blockId)],
      expectedVersion: site.page.version,
    });
    await ctx.api.publish(site.site.id);

    const checkoutResponse = await fetch(`${API_URL}/v1/runtime/payment-blocks/${blockId}/checkout`, { method: "POST" });
    expect(checkoutResponse.status).toBe(404);
  });
});

/**
 * KAN-1265: the editor had zero UI for any of the above — no way to
 * connect/disconnect BYO-Stripe or see a payment/subscription block's own
 * records short of calling the API directly (which is exactly what the
 * describe block above does). This exercises the new "Payments" toolbar
 * button + SideSheet (apps/editor/src/PaymentsPanel.tsx) end to end through
 * the browser: connecting Stripe from the panel's own form, the payment
 * block showing up (found by the panel walking the site's pages itself —
 * there's still no "list blocks by type" endpoint), and a completed
 * checkout (driven the same dev-advance way the API-level test above does —
 * no real Stripe Checkout page exists in this environment) showing up once
 * the panel is reopened.
 */
test.describe("editor UI: Payments panel (KAN-1265)", () => {
  test("connect Stripe from the panel, then see a completed payment on the block it's attached to", async ({ page }) => {
    const { ctx, site } = await authenticatedContext("payments-ui");
    const blockId = newUlid();

    await ctx.api.writePage(site.site.id, site.page.id, {
      title: site.page.title,
      slug: site.page.slug,
      blocks: [paymentBlock(blockId, 2000)],
      expectedVersion: site.page.version,
    });

    await loginInBrowser(page);
    await openSiteByName(page, site.site.name);

    const header = page.locator("header").first();
    await header.getByRole("button", { name: /^payments$/i }).click();
    const panel = page.getByRole("dialog", { name: /^payments$/i });
    await expect(panel).toBeVisible();

    // Not connected yet — the connect form is shown, no "Disconnect" option.
    await expect(panel.getByText(/connect your own stripe account/i)).toBeVisible();

    await panel.getByLabel(/stripe authorization code/i).fill("fake-authorization-code");
    await panel.getByRole("button", { name: /^connect stripe$/i }).click();
    await expect(panel.getByText(/^connected$/i)).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByRole("button", { name: /disconnect stripe/i })).toBeVisible();

    // The Payment block is found by walking the site's pages, with no
    // records against it yet.
    await expect(panel.getByText("Buy the thing")).toBeVisible();
    await panel.getByText("Buy the thing").click();
    await expect(panel.getByText(/no payments yet/i)).toBeVisible();
    await panel.getByRole("button", { name: /all blocks/i }).click();

    // Complete a checkout the same way the API-level test above does — the
    // published Payment block's own "Pay now" button calls this same
    // unauthenticated runtime endpoint, then dev-advance simulates Stripe's
    // checkout.session.completed webhook.
    await ctx.api.publish(site.site.id);
    const checkoutResponse = await fetch(`${API_URL}/v1/runtime/payment-blocks/${blockId}/checkout`, { method: "POST" });
    expect(checkoutResponse.status).toBe(201);
    const { url } = (await checkoutResponse.json()) as { url: string };
    const sessionId = sessionIdFromCheckoutUrl(url);
    const advanceResponse = await fetch(`${API_URL}/v1/dev/stripe-connect/${site.site.id}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, buyerEmail: "buyer@example.com" }),
    });
    expect(advanceResponse.status).toBe(200);

    // Reopening the block's records shows the completed payment — this
    // panel doesn't poll, so a fresh selection is what re-fetches.
    await panel.getByText("Buy the thing").click();
    await expect(panel.getByText("buyer@example.com")).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText(/^completed$/i)).toBeVisible();
  });

  test("disconnecting Stripe from the panel brings back the connect form", async ({ page }) => {
    const { ctx, site } = await authenticatedContext("payments-ui-disconnect");
    await ctx.api.connectStripe(site.site.id, { authorizationCode: "fake-authorization-code" });

    await loginInBrowser(page);
    await openSiteByName(page, site.site.name);

    const header = page.locator("header").first();
    await header.getByRole("button", { name: /^payments$/i }).click();
    const panel = page.getByRole("dialog", { name: /^payments$/i });
    await expect(panel.getByText(/^connected$/i)).toBeVisible({ timeout: 10_000 });

    await panel.getByRole("button", { name: /disconnect stripe/i }).click();
    await expect(panel.getByText(/connect your own stripe account/i)).toBeVisible({ timeout: 10_000 });

    const status = await ctx.api.getStripeStatus(site.site.id);
    expect(status).toBeNull();
  });
});
