import { test, expect } from "@playwright/test";
import { newUlid } from "@prefab/schema";
import { API_URL, authenticatedContext } from "./helpers.js";

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
