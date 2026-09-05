import { describe, expect, it } from "vitest";
import {
  createSubscriptionCheckout,
  type CreateSubscriptionCheckoutDeps,
  type SubscriptionBlockManifest,
  type CreatedSubscriptionRecord,
} from "../src/checkout.js";
import type { StripeConnectionRecord } from "../src/checkout.js";

/**
 * KAN-1154 / ADR-0016 — no equivalent unit test exists for the one-off
 * createPaymentCheckout (it's exercised only via apps/api's Postgres
 * integration test), but this function has the same "narrow port,
 * injected" shape book.ts's own tests already cover with in-memory fakes,
 * so it gets one here in addition to apps/api/test/subscriptions.
 * integration.test.ts's Postgres-backed coverage.
 */

const BLOCK: SubscriptionBlockManifest = {
  id: "block1",
  siteId: "site1",
  heading: "Pro plan",
  description: "",
  buttonLabel: "Subscribe",
  price: 2500,
  currency: "usd",
  interval: "month",
  trialPeriodDays: 14,
  successMessage: "You're subscribed.",
};

const CONNECTION: StripeConnectionRecord = { stripeAccountId: "acct_1", accessToken: "token_1", status: "connected" };

function makeDeps(overrides: Partial<CreateSubscriptionCheckoutDeps> = {}): {
  deps: CreateSubscriptionCheckoutDeps;
  createdRecords: CreatedSubscriptionRecord[];
  checkoutCalls: unknown[];
} {
  const createdRecords: CreatedSubscriptionRecord[] = [];
  const checkoutCalls: unknown[] = [];

  const deps: CreateSubscriptionCheckoutDeps = {
    subscriptionBlocks: { async getBlock(id) { return id === BLOCK.id ? BLOCK : null; } },
    stripeConnections: { async getConnection(siteId) { return siteId === BLOCK.siteId ? CONNECTION : null; } },
    subscriptionRecords: {
      async create(input) {
        const record = { id: input.id };
        createdRecords.push(record);
        return record;
      },
    },
    tenantStripe: {
      async createSubscriptionCheckoutSession(input) {
        checkoutCalls.push(input);
        return { sessionId: `cs_${input.subscriptionRecordId}`, url: `https://checkout.stripe.example/${input.subscriptionRecordId}` };
      },
    },
    ...overrides,
  };

  return { deps, createdRecords, checkoutCalls };
}

describe("createSubscriptionCheckout", () => {
  it("resolves price/currency/interval/trialPeriodDays from the block's own manifest, never from the caller", async () => {
    const { deps, checkoutCalls } = makeDeps();
    const outcome = await createSubscriptionCheckout(
      { id: "rec1", blockId: BLOCK.id, successUrl: "https://example.com/success", cancelUrl: "https://example.com/cancel" },
      deps,
    );
    expect(outcome).toEqual({ status: "created", url: "https://checkout.stripe.example/rec1" });
    expect(checkoutCalls).toEqual([
      {
        accessToken: CONNECTION.accessToken,
        stripeAccountId: CONNECTION.stripeAccountId,
        price: BLOCK.price,
        currency: BLOCK.currency,
        interval: BLOCK.interval,
        trialPeriodDays: BLOCK.trialPeriodDays,
        productName: BLOCK.heading,
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        subscriptionRecordId: "rec1",
        siteId: BLOCK.siteId,
      },
    ]);
  });

  it("creates a subscription record once the checkout session is created", async () => {
    const { deps, createdRecords } = makeDeps();
    await createSubscriptionCheckout({ id: "rec1", blockId: BLOCK.id, successUrl: "u", cancelUrl: "u" }, deps);
    expect(createdRecords).toEqual([{ id: "rec1" }]);
  });

  it("returns not_found when the block doesn't exist", async () => {
    const { deps } = makeDeps();
    const outcome = await createSubscriptionCheckout({ id: "rec1", blockId: "missing", successUrl: "u", cancelUrl: "u" }, deps);
    expect(outcome).toEqual({ status: "not_found" });
  });

  it("returns no_connection when the site has no connected Stripe account", async () => {
    const { deps } = makeDeps({ stripeConnections: { async getConnection() { return null; } } });
    const outcome = await createSubscriptionCheckout({ id: "rec1", blockId: BLOCK.id, successUrl: "u", cancelUrl: "u" }, deps);
    expect(outcome).toEqual({ status: "no_connection" });
  });

  it("returns provider_error when the tenant's own Stripe rejects the request, and never creates a record", async () => {
    const { deps, createdRecords } = makeDeps({
      tenantStripe: {
        async createSubscriptionCheckoutSession() {
          throw new Error("boom");
        },
      },
    });
    const outcome = await createSubscriptionCheckout({ id: "rec1", blockId: BLOCK.id, successUrl: "u", cancelUrl: "u" }, deps);
    expect(outcome).toEqual({ status: "provider_error" });
    expect(createdRecords).toHaveLength(0);
  });

  it("falls back to a generic product name when the block has no heading", async () => {
    const { deps, checkoutCalls } = makeDeps({
      subscriptionBlocks: { async getBlock(id) { return id === BLOCK.id ? { ...BLOCK, heading: "" } : null; } },
    });
    await createSubscriptionCheckout({ id: "rec1", blockId: BLOCK.id, successUrl: "u", cancelUrl: "u" }, deps);
    expect((checkoutCalls[0] as { productName: string }).productName).toBe("Subscription");
  });
});
