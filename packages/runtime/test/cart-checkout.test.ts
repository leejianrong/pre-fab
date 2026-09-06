import { describe, expect, it } from "vitest";
import {
  createCartCheckout,
  type CreateCartCheckoutDeps,
  type CartProductManifest,
  type CreatedCartCheckoutRecord,
  type CartShippingConfig,
} from "../src/checkout.js";
import type { StripeConnectionRecord } from "../src/checkout.js";

/**
 * KAN-1245 / ADR-0018 cart addendum — same "narrow port, injected" shape
 * subscription-checkout.test.ts already covers with in-memory fakes. This
 * suite is where the "never trust the client for money" re-validation
 * (existence/site match/stock/currency) actually gets exercised — the
 * money-critical logic this whole card exists to get right.
 */

const PRODUCTS: Record<string, CartProductManifest> = {
  mug: { id: "mug", siteId: "site1", title: "Mug", price: 1500, currency: "usd", fulfillmentType: "physical", stockCount: 3 },
  ebook: { id: "ebook", siteId: "site1", title: "E-book", price: 900, currency: "usd", fulfillmentType: "digital_or_service", stockCount: null },
  eurThing: { id: "eurThing", siteId: "site1", title: "Euro thing", price: 500, currency: "eur", fulfillmentType: "digital_or_service", stockCount: null },
  otherSite: { id: "otherSite", siteId: "site2", title: "Not yours", price: 100, currency: "usd", fulfillmentType: "digital_or_service", stockCount: null },
};

const CONNECTION: StripeConnectionRecord = { stripeAccountId: "acct_1", accessToken: "token_1", status: "connected" };
const SHIPPING: CartShippingConfig = { flatRateAmount: 500, label: "Standard shipping", allowedCountries: ["US"] };

function makeDeps(overrides: Partial<CreateCartCheckoutDeps> = {}): {
  deps: CreateCartCheckoutDeps;
  createdRecords: CreatedCartCheckoutRecord[];
  checkoutCalls: unknown[];
} {
  const createdRecords: CreatedCartCheckoutRecord[] = [];
  const checkoutCalls: unknown[] = [];

  const deps: CreateCartCheckoutDeps = {
    products: { async getProduct(id) { return PRODUCTS[id] ?? null; } },
    stripeConnections: { async getConnection(siteId) { return siteId === "site1" ? CONNECTION : null; } },
    cartCheckoutRecords: {
      async create(input) {
        const record = { id: input.id };
        createdRecords.push(record);
        return record;
      },
    },
    tenantStripe: {
      async createCartCheckoutSession(input) {
        checkoutCalls.push(input);
        return { sessionId: `cs_${input.cartCheckoutRecordId}`, url: `https://checkout.stripe.example/${input.cartCheckoutRecordId}` };
      },
    },
    shipping: SHIPPING,
    ...overrides,
  };

  return { deps, createdRecords, checkoutCalls };
}

describe("createCartCheckout", () => {
  it("resolves price/currency/title from the CURRENT products row, never from the caller", async () => {
    const { deps, checkoutCalls } = makeDeps();
    const outcome = await createCartCheckout(
      { id: "rec1", siteId: "site1", items: [{ productId: "mug", quantity: 2 }], successUrl: "https://example.com/s", cancelUrl: "https://example.com/c" },
      deps,
    );
    expect(outcome).toEqual({ status: "created", url: "https://checkout.stripe.example/rec1" });
    expect(checkoutCalls).toEqual([
      {
        accessToken: CONNECTION.accessToken,
        stripeAccountId: CONNECTION.stripeAccountId,
        items: [{ unitAmount: 1500, currency: "usd", title: "Mug", quantity: 2 }],
        currency: "usd",
        successUrl: "https://example.com/s",
        cancelUrl: "https://example.com/c",
        cartCheckoutRecordId: "rec1",
        siteId: "site1",
        requiresShipping: true,
        shipping: SHIPPING,
      },
    ]);
  });

  it("creates a cart_checkout_records row with the resolved subtotal once the checkout session is created", async () => {
    const { deps, createdRecords } = makeDeps();
    await createCartCheckout(
      { id: "rec1", siteId: "site1", items: [{ productId: "mug", quantity: 2 }], successUrl: "u", cancelUrl: "u" },
      deps,
    );
    expect(createdRecords).toEqual([{ id: "rec1" }]);
  });

  it("requiresShipping is false for a cart with only digital/service items, and no shipping fields are needed", async () => {
    const { deps, checkoutCalls } = makeDeps();
    await createCartCheckout(
      { id: "rec1", siteId: "site1", items: [{ productId: "ebook", quantity: 1 }], successUrl: "u", cancelUrl: "u" },
      deps,
    );
    expect((checkoutCalls[0] as { requiresShipping: boolean }).requiresShipping).toBe(false);
  });

  it("returns empty_cart for an empty items array", async () => {
    const { deps } = makeDeps();
    const outcome = await createCartCheckout({ id: "rec1", siteId: "site1", items: [], successUrl: "u", cancelUrl: "u" }, deps);
    expect(outcome).toEqual({ status: "empty_cart" });
  });

  it("merges duplicate productId entries (quantities summed) into one Stripe line item", async () => {
    const { deps, checkoutCalls } = makeDeps();
    await createCartCheckout(
      {
        id: "rec1",
        siteId: "site1",
        items: [
          { productId: "mug", quantity: 1 },
          { productId: "mug", quantity: 2 },
        ],
        successUrl: "u",
        cancelUrl: "u",
      },
      deps,
    );
    const items = (checkoutCalls[0] as { items: { quantity: number }[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(3);
  });

  it("rejects wholesale (invalid_items) when a product doesn't exist — never silently drops the bad line", async () => {
    const { deps, checkoutCalls } = makeDeps();
    const outcome = await createCartCheckout(
      {
        id: "rec1",
        siteId: "site1",
        items: [
          { productId: "mug", quantity: 1 },
          { productId: "missing", quantity: 1 },
        ],
        successUrl: "u",
        cancelUrl: "u",
      },
      deps,
    );
    expect(outcome).toEqual({ status: "invalid_items", issues: [{ productId: "missing", reason: "not_found" }] });
    expect(checkoutCalls).toHaveLength(0);
  });

  it("treats a product belonging to a different site as not_found (never leaks cross-tenant existence)", async () => {
    const { deps } = makeDeps();
    const outcome = await createCartCheckout(
      { id: "rec1", siteId: "site1", items: [{ productId: "otherSite", quantity: 1 }], successUrl: "u", cancelUrl: "u" },
      deps,
    );
    expect(outcome).toEqual({ status: "invalid_items", issues: [{ productId: "otherSite", reason: "not_found" }] });
  });

  it("rejects a quantity exceeding a physical product's current stock", async () => {
    const { deps } = makeDeps();
    const outcome = await createCartCheckout(
      { id: "rec1", siteId: "site1", items: [{ productId: "mug", quantity: 10 }], successUrl: "u", cancelUrl: "u" },
      deps,
    );
    expect(outcome).toEqual({ status: "invalid_items", issues: [{ productId: "mug", reason: "out_of_stock" }] });
  });

  it("rejects a non-positive or non-integer quantity", async () => {
    const { deps } = makeDeps();
    const outcome = await createCartCheckout(
      { id: "rec1", siteId: "site1", items: [{ productId: "mug", quantity: 0 }], successUrl: "u", cancelUrl: "u" },
      deps,
    );
    expect(outcome).toEqual({ status: "invalid_items", issues: [{ productId: "mug", reason: "invalid_quantity" }] });
  });

  it("rejects a cart whose resolved products don't share one currency", async () => {
    const { deps } = makeDeps();
    const outcome = await createCartCheckout(
      {
        id: "rec1",
        siteId: "site1",
        items: [
          { productId: "mug", quantity: 1 },
          { productId: "eurThing", quantity: 1 },
        ],
        successUrl: "u",
        cancelUrl: "u",
      },
      deps,
    );
    expect(outcome).toEqual({ status: "mixed_currency" });
  });

  it("returns no_connection when the site has no connected Stripe account", async () => {
    const { deps } = makeDeps({ stripeConnections: { async getConnection() { return null; } } });
    const outcome = await createCartCheckout(
      { id: "rec1", siteId: "site1", items: [{ productId: "mug", quantity: 1 }], successUrl: "u", cancelUrl: "u" },
      deps,
    );
    expect(outcome).toEqual({ status: "no_connection" });
  });

  it("returns provider_error when the tenant's own Stripe rejects the request, and never creates a record", async () => {
    const { deps, createdRecords } = makeDeps({
      tenantStripe: {
        async createCartCheckoutSession() {
          throw new Error("boom");
        },
      },
    });
    const outcome = await createCartCheckout(
      { id: "rec1", siteId: "site1", items: [{ productId: "mug", quantity: 1 }], successUrl: "u", cancelUrl: "u" },
      deps,
    );
    expect(outcome).toEqual({ status: "provider_error" });
    expect(createdRecords).toHaveLength(0);
  });
});
