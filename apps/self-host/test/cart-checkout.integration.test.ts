import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { openSelfHostDb, type SelfHostDb } from "../src/db.js";
import { seedProductsFromBundle } from "../src/products-seed.js";
import { RealTenantStripeProvider } from "../src/lib/tenant-stripe.js";

/**
 * KAN-1247 / ADR-0018 (part 4 addendum) — the self-host mirror of
 * apps/api/test/orders.integration.test.ts's cart-order-lifecycle coverage,
 * against SQLite instead of Postgres: the runtime cart-checkout route,
 * live stock display, the dev-advance path driving
 * cart-order-webhook.ts (stock decrement + order_items creation, oversell
 * handling, idempotency), the post-purchase receipt endpoint, and the real
 * signature-verified webhook's new cart branch.
 */

let dir: string;
let bundleDir: string;
let db: SelfHostDb;
let app: FastifyInstance;
const SITE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const PHYSICAL_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const DIGITAL_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB2";
const DRAFT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB3";

function sessionIdFromUrl(url: string): string {
  return new URL(url).pathname.split("/").pop()!;
}

function connectStripe(): Promise<unknown> {
  return app.inject({ method: "POST", url: "/v1/stripe/connect", payload: { siteId: SITE_ID, authorizationCode: "fake-code" } }).then((r) => r.json());
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pf-selfhost-cart-"));
  bundleDir = path.join(dir, "bundle");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(path.join(bundleDir, "index.html"), "<!doctype html><title>Shop</title>", "utf8");
  // KAN-1247's own manifest — seeded through the real bundle-seed path
  // (not a hand-authored SQL INSERT) so this test also exercises
  // products-seed.ts itself, including the draft row's status filter.
  await writeFile(
    path.join(bundleDir, "prefab-products.json"),
    JSON.stringify([
      { id: PHYSICAL_ID, siteId: SITE_ID, title: "Mug", price: 1500, currency: "usd", fulfillmentType: "physical", stockCount: 2, successMessage: "Thanks for your order!", status: "published" },
      {
        id: DIGITAL_ID,
        siteId: SITE_ID,
        title: "Ebook",
        price: 2000,
        currency: "usd",
        fulfillmentType: "digital_or_service",
        stockCount: null,
        successMessage: "Your download link is in your inbox.",
        status: "published",
      },
      { id: DRAFT_ID, siteId: SITE_ID, title: "Unreleased widget", price: 500, currency: "usd", fulfillmentType: "physical", stockCount: 10, successMessage: "", status: "draft" },
    ]),
    "utf8",
  );

  db = openSelfHostDb(path.join(dir, "prefab.db"));
  await seedProductsFromBundle(db, bundleDir);

  app = buildApp({ bundleDir, db, runtimeApiUrl: "http://localhost:8080" });
  await app.ready();
  await connectStripe();
});

afterAll(async () => {
  await app.close();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("apps/self-host cart checkout -> order lifecycle (KAN-1247 / ADR-0018 part 4 addendum)", () => {
  it("answers a CORS preflight for the cart-checkout route", async () => {
    const response = await app.inject({ method: "OPTIONS", url: `/v1/runtime/sites/${SITE_ID}/cart-checkout` });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
  });

  it("live stock display reflects the seeded manifest, and 404s a draft product (published-only, mirroring products_public_read)", async () => {
    const physical = await app.inject({ method: "GET", url: `/v1/runtime/sites/${SITE_ID}/products/${PHYSICAL_ID}/stock` });
    expect(physical.statusCode).toBe(200);
    expect(physical.json()).toEqual({ fulfillmentType: "physical", stockCount: 2 });

    const draft = await app.inject({ method: "GET", url: `/v1/runtime/sites/${SITE_ID}/products/${DRAFT_ID}/stock` });
    expect(draft.statusCode).toBe(404);
  });

  it("rejects a cart item requesting more than the current stock", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/runtime/sites/${SITE_ID}/cart-checkout`,
      payload: { items: [{ productId: PHYSICAL_ID, quantity: 99 }] },
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { message: string } }).error.message).toContain("failed validation");
  });

  it("rejects a cart referencing a draft product's id — the same public-read scoping createCartCheckout relies on", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/runtime/sites/${SITE_ID}/cart-checkout`,
      payload: { items: [{ productId: DRAFT_ID, quantity: 1 }] },
    });
    expect(response.statusCode).toBe(400);
  });

  it("completes a mixed physical+digital cart: decrements stock, marks the digital line delivered", async () => {
    const checkout = await app.inject({
      method: "POST",
      url: `/v1/runtime/sites/${SITE_ID}/cart-checkout`,
      payload: { items: [{ productId: PHYSICAL_ID, quantity: 1 }, { productId: DIGITAL_ID, quantity: 2 }] },
    });
    expect(checkout.statusCode).toBe(201);
    const { url } = checkout.json() as { url: string };
    const sessionId = sessionIdFromUrl(url);

    const advance = await app.inject({ method: "POST", url: "/v1/dev/stripe-connect/cart/advance", payload: { sessionId } });
    expect(advance.statusCode).toBe(200);
    const outcome = advance.json() as { status: string; cartCheckoutRecord: { id: string; status: string }; orderItems: Array<{ fulfillmentType: string; status: string; oversold: boolean }> };
    expect(outcome.status).toBe("applied");
    expect(outcome.cartCheckoutRecord.status).toBe("completed");
    const physicalLine = outcome.orderItems.find((item) => item.fulfillmentType === "physical")!;
    expect(physicalLine.status).toBe("unfulfilled");
    expect(physicalLine.oversold).toBe(false);
    const digitalLine = outcome.orderItems.find((item) => item.fulfillmentType === "digital_or_service")!;
    expect(digitalLine.status).toBe("delivered");

    const stock = await app.inject({ method: "GET", url: `/v1/runtime/sites/${SITE_ID}/products/${PHYSICAL_ID}/stock` });
    expect((stock.json() as { stockCount: number }).stockCount).toBe(1);

    const receipt = await app.inject({ method: "GET", url: `/v1/runtime/sites/${SITE_ID}/cart-checkout/${outcome.cartCheckoutRecord.id}/receipt` });
    expect(receipt.statusCode).toBe(200);
    const receiptBody = receipt.json() as { items: Array<{ productId: string; successMessage: string }> };
    expect(receiptBody.items.find((item) => item.productId === DIGITAL_ID)?.successMessage).toBe("Your download link is in your inbox.");
  });

  it("404s a receipt for a still-pending (never advanced) cart checkout", async () => {
    const checkout = await app.inject({
      method: "POST",
      url: `/v1/runtime/sites/${SITE_ID}/cart-checkout`,
      payload: { items: [{ productId: DIGITAL_ID, quantity: 1 }] },
    });
    const { url } = checkout.json() as { url: string };
    const sessionId = sessionIdFromUrl(url);
    const pendingId = (db.prepare("SELECT id FROM cart_checkout_records WHERE stripe_session_id = ?").get(sessionId) as { id: string }).id;

    const receipt = await app.inject({ method: "GET", url: `/v1/runtime/sites/${SITE_ID}/cart-checkout/${pendingId}/receipt` });
    expect(receipt.statusCode).toBe(404);
  });

  it("oversell: two carts race for the last unit — the second order is still created, flagged oversold, and stock floors at zero", async () => {
    db.prepare("UPDATE products SET stock_count = 1 WHERE id = ?").run(PHYSICAL_ID);

    const first = await app.inject({ method: "POST", url: `/v1/runtime/sites/${SITE_ID}/cart-checkout`, payload: { items: [{ productId: PHYSICAL_ID, quantity: 1 }] } });
    const second = await app.inject({ method: "POST", url: `/v1/runtime/sites/${SITE_ID}/cart-checkout`, payload: { items: [{ productId: PHYSICAL_ID, quantity: 1 }] } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const firstSessionId = sessionIdFromUrl((first.json() as { url: string }).url);
    const secondSessionId = sessionIdFromUrl((second.json() as { url: string }).url);

    const firstAdvance = await app.inject({ method: "POST", url: "/v1/dev/stripe-connect/cart/advance", payload: { sessionId: firstSessionId } });
    const firstOutcome = firstAdvance.json() as { orderItems: Array<{ oversold: boolean }> };
    expect(firstOutcome.orderItems[0]!.oversold).toBe(false);

    const secondAdvance = await app.inject({ method: "POST", url: "/v1/dev/stripe-connect/cart/advance", payload: { sessionId: secondSessionId } });
    const secondOutcome = secondAdvance.json() as { orderItems: Array<{ oversold: boolean }> };
    expect(secondOutcome.orderItems[0]!.oversold).toBe(true);

    const stock = db.prepare("SELECT stock_count FROM products WHERE id = ?").get(PHYSICAL_ID) as { stock_count: number };
    expect(stock.stock_count).toBe(0);
  });

  it("idempotency: an exact-duplicate event id redelivered is deduped, and a redelivery after completion no-ops", async () => {
    db.prepare("UPDATE products SET stock_count = 5 WHERE id = ?").run(PHYSICAL_ID);
    const checkout = await app.inject({ method: "POST", url: `/v1/runtime/sites/${SITE_ID}/cart-checkout`, payload: { items: [{ productId: PHYSICAL_ID, quantity: 1 }] } });
    const sessionId = sessionIdFromUrl((checkout.json() as { url: string }).url);
    const eventId = `evt_dup_${Date.now()}`;

    const first = await app.inject({ method: "POST", url: "/v1/dev/stripe-connect/cart/advance", payload: { sessionId, eventId } });
    expect((first.json() as { status: string }).status).toBe("applied");

    const redelivered = await app.inject({ method: "POST", url: "/v1/dev/stripe-connect/cart/advance", payload: { sessionId, eventId } });
    expect((redelivered.json() as { status: string }).status).toBe("deduped");

    // A different event id, arriving after the row is already 'completed',
    // must also no-op (the fromStatuses-style guard, not just the exact
    // redelivery guard).
    const differentEventLate = await app.inject({ method: "POST", url: "/v1/dev/stripe-connect/cart/advance", payload: { sessionId, eventId: `evt_late_${Date.now()}` } });
    expect(differentEventLate.statusCode).toBe(404);
  });

  it("404s the dev-advance route for an unknown session id", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/dev/stripe-connect/cart/advance", payload: { sessionId: "cs_never_existed" } });
    expect(response.statusCode).toBe(404);
  });
});

describe("apps/self-host — real, signature-verified /v1/webhooks/stripe-connect cart branch (KAN-1247)", () => {
  const STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_test_selfhost_cart";

  function signStripePayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
    return `t=${timestamp},v1=${signature}`;
  }

  it("processes a signed checkout.session.completed event with metadata.checkoutType = 'cart'", async () => {
    const realApp = buildApp({
      bundleDir,
      db,
      runtimeApiUrl: "http://localhost:8080",
      tenantStripeProvider: new RealTenantStripeProvider("sk_test_unused"),
      stripeConnectWebhookSecret: STRIPE_CONNECT_WEBHOOK_SECRET,
    });
    await realApp.ready();
    try {
      const stripeSessionId = `cs_cart_real_${Date.now()}`;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO cart_checkout_records (id, site_id, stripe_session_id, items, currency, amount_subtotal, requires_shipping, created_at, updated_at)
         VALUES (@id, @siteId, @stripeSessionId, @items, 'usd', 2000, 0, @now, @now)`,
      ).run({
        id: `rec_${stripeSessionId}`,
        siteId: SITE_ID,
        stripeSessionId,
        items: JSON.stringify([{ productId: DIGITAL_ID, quantity: 1, unitAmount: 2000, currency: "usd", title: "Ebook", fulfillmentType: "digital_or_service" }]),
        now,
      });

      const rawBody = JSON.stringify({
        id: `evt_cart_real_${Date.now()}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: stripeSessionId,
            mode: "payment",
            metadata: { siteId: SITE_ID, checkoutType: "cart" },
            customer_details: { email: "buyer@example.com" },
          },
        },
      });
      const signature = signStripePayload(rawBody, STRIPE_CONNECT_WEBHOOK_SECRET);

      const response = await realApp.inject({
        method: "POST",
        url: "/v1/webhooks/stripe-connect",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        payload: rawBody,
      });
      expect(response.statusCode).toBe(200);

      const record = db.prepare("SELECT status, buyer_email FROM cart_checkout_records WHERE stripe_session_id = ?").get(stripeSessionId) as { status: string; buyer_email: string };
      expect(record.status).toBe("completed");
      expect(record.buyer_email).toBe("buyer@example.com");
    } finally {
      await realApp.close();
    }
  });

  it("still ignores a one-off (non-cart) payment-mode session, the pre-existing gap this card does not fix", async () => {
    const realApp = buildApp({
      bundleDir,
      db,
      runtimeApiUrl: "http://localhost:8080",
      tenantStripeProvider: new RealTenantStripeProvider("sk_test_unused"),
      stripeConnectWebhookSecret: STRIPE_CONNECT_WEBHOOK_SECRET,
    });
    await realApp.ready();
    try {
      const rawBody = JSON.stringify({
        id: `evt_oneoff_${Date.now()}`,
        type: "checkout.session.completed",
        data: { object: { id: `cs_oneoff_${Date.now()}`, mode: "payment", metadata: { siteId: SITE_ID } } },
      });
      const signature = signStripePayload(rawBody, STRIPE_CONNECT_WEBHOOK_SECRET);
      const response = await realApp.inject({
        method: "POST",
        url: "/v1/webhooks/stripe-connect",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        payload: rawBody,
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await realApp.close();
    }
  });
});
