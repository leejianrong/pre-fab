import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { newUlid } from "@prefab/schema";
import { withTenantContext, runMigrations, createAccount } from "@prefab/db";
import { FakeTenantStripeProvider } from "../src/lib/tenant-stripe-provider.js";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

const { Pool } = pg;

const migrateUrl = process.env.MIGRATE_DATABASE_URL_TEST;
const appUrl = process.env.DATABASE_URL_TEST;
if (!migrateUrl || !appUrl) {
  throw new Error("MIGRATE_DATABASE_URL_TEST and DATABASE_URL_TEST must be set — see .env.example");
}

const migratePool = new Pool({ connectionString: migrateUrl });
const appPool = new Pool({ connectionString: appUrl });

let bundleStoreDir: string;
let assetStoreDir: string;
let app: FastifyInstance;
let tenantStripeProvider: FakeTenantStripeProvider;
const TEST_PLATFORM_HOST = "prefab-orders.test";

beforeAll(async () => {
  await runMigrations(migratePool);
  await migratePool.query(
    "TRUNCATE order_items, cart_checkout_records, products, stripe_connections, custom_domains, assets, publishes, blocks, pages, themes, sites, api_tokens, sessions, accounts CASCADE",
  );
  bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-orders-bundles-"));
  assetStoreDir = await mkdtemp(path.join(tmpdir(), "pf-orders-assets-"));

  tenantStripeProvider = new FakeTenantStripeProvider();
  app = buildApp({ pool: appPool, bundleStoreDir, assetStoreDir, platformHost: TEST_PLATFORM_HOST, tenantStripeProvider });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await migratePool.end();
  await appPool.end();
  if (bundleStoreDir) await rm(bundleStoreDir, { recursive: true, force: true });
  if (assetStoreDir) await rm(assetStoreDir, { recursive: true, force: true });
});

async function seedAccountAndLogin(email: string) {
  await withTenantContext(migratePool, {}, (client) => createAccount(client, { id: newUlid(), email }));
  const login = await app.inject({ method: "POST", url: "/v1/dev/login", payload: { email } });
  const cookieHeader = login.headers["set-cookie"];
  const cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  return cookie!.split(";")[0]!;
}

function sessionIdFromUrl(url: string): string {
  return new URL(url).pathname.split("/").pop()!;
}

async function createSiteWithStripe(cookie: string): Promise<string> {
  const created = await app.inject({ method: "POST", url: "/v1/sites", headers: { cookie }, payload: { slug: `orders-site-${newUlid()}`, name: "Orders Site" } });
  const { site } = created.json() as { site: { id: string } };
  const connect = await app.inject({ method: "POST", url: `/v1/sites/${site.id}/stripe`, headers: { cookie }, payload: { authorizationCode: "fake-code" } });
  expect(connect.statusCode).toBe(200);
  return site.id;
}

async function createPublishedProduct(
  cookie: string,
  siteId: string,
  input: { title: string; price: number; fulfillmentType?: "physical" | "digital_or_service"; stockCount?: number | null; successMessage?: string },
): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: `/v1/sites/${siteId}/products`,
    headers: { cookie },
    payload: { ...input, status: "published" },
  });
  expect(created.statusCode).toBe(200);
  const product = created.json() as { id: string };
  return product.id;
}

/**
 * KAN-1246 / ADR-0018 (part 3 addendum): the full cart-order lifecycle
 * through the real HTTP routes — runtime cart-checkout creation, the
 * dev-advance route driving the same applyCartCheckoutCompleted a real
 * checkout.session.completed webhook would, the owner-facing order.list/
 * order.get/order.markShipped/order.export routes, the runtime stock-check
 * endpoint, and the post-purchase receipt endpoint. Mirrors payments.
 * integration.test.ts's own harness shape.
 */
describe("cart checkout -> order lifecycle (KAN-1246 / ADR-0018 part 3 addendum)", () => {
  it("completes a mixed physical+digital cart: decrements stock, marks the digital line delivered, and the owner can list/get/ship/export it", async () => {
    const cookie = await seedAccountAndLogin(`orders-happy-${newUlid()}@example.com`);
    const siteId = await createSiteWithStripe(cookie);

    const physicalId = await createPublishedProduct(cookie, siteId, { title: "Mug", price: 1500, stockCount: 5 });
    const digitalId = await createPublishedProduct(cookie, siteId, {
      title: "Ebook",
      price: 2000,
      fulfillmentType: "digital_or_service",
      stockCount: null,
      successMessage: "Your download link is in your inbox.",
    });

    const checkout = await app.inject({
      method: "POST",
      url: `/v1/runtime/sites/${siteId}/cart-checkout`,
      payload: { items: [{ productId: physicalId, quantity: 2 }, { productId: digitalId, quantity: 1 }] },
    });
    expect(checkout.statusCode).toBe(201);
    const { url } = checkout.json() as { url: string };
    const sessionId = sessionIdFromUrl(url);

    const advance = await app.inject({
      method: "POST",
      url: `/v1/dev/stripe-connect/${siteId}/cart/advance`,
      payload: { sessionId, buyerEmail: "buyer@example.com" },
    });
    expect(advance.statusCode).toBe(200);
    const advanceBody = advance.json() as {
      status: string;
      cartCheckoutRecord: { id: string; status: string; buyerEmail: string; amountSubtotal: number };
      orderItems: Array<{ id: string; productId: string; status: string; fulfillmentType: string; oversold: boolean }>;
    };
    expect(advanceBody.status).toBe("applied");
    expect(advanceBody.cartCheckoutRecord.status).toBe("completed");
    expect(advanceBody.cartCheckoutRecord.buyerEmail).toBe("buyer@example.com");
    expect(advanceBody.cartCheckoutRecord.amountSubtotal).toBe(1500 * 2 + 2000);
    expect(advanceBody.orderItems).toHaveLength(2);
    const physicalItem = advanceBody.orderItems.find((i) => i.productId === physicalId)!;
    const digitalItem = advanceBody.orderItems.find((i) => i.productId === digitalId)!;
    expect(physicalItem.status).toBe("unfulfilled");
    expect(physicalItem.oversold).toBe(false);
    expect(digitalItem.status).toBe("delivered");

    // Stock decremented atomically — visible both via the direct product
    // read and the new runtime stock-check endpoint.
    const stock = await app.inject({ method: "GET", url: `/v1/runtime/sites/${siteId}/products/${physicalId}/stock` });
    expect(stock.statusCode).toBe(200);
    expect((stock.json() as { stockCount: number }).stockCount).toBe(3);

    // A redelivered webhook (e.g. Stripe retrying) must be a no-op — the
    // idempotency guard, exercised end to end.
    const redelivered = await app.inject({
      method: "POST",
      url: `/v1/dev/stripe-connect/${siteId}/cart/advance`,
      payload: { sessionId, buyerEmail: "buyer@example.com" },
    });
    expect(redelivered.statusCode).toBe(404);
    const restock = await app.inject({ method: "GET", url: `/v1/runtime/sites/${siteId}/products/${physicalId}/stock` });
    expect((restock.json() as { stockCount: number }).stockCount).toBe(3);

    // order.list / order.get (owner-facing) ----
    const list = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/orders`, headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { records: Array<{ id: string; status: string }>; total: number };
    expect(listBody.total).toBe(1);
    const orderId = listBody.records[0]!.id;
    expect(orderId).toBe(advanceBody.cartCheckoutRecord.id);

    const detail = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/orders/${orderId}`, headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as { order: { status: string }; items: Array<{ id: string; productId: string; status: string }> };
    expect(detailBody.order.status).toBe("completed");
    expect(detailBody.items).toHaveLength(2);

    // order.markShipped ----
    const shipTarget = detailBody.items.find((i) => i.productId === physicalId)!;
    const ship = await app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/orders/items/${shipTarget.id}/ship`,
      headers: { cookie },
      payload: { trackingNumber: "1Z999" },
    });
    expect(ship.statusCode).toBe(200);
    const shipped = ship.json() as { status: string; trackingNumber: string };
    expect(shipped.status).toBe("shipped");
    expect(shipped.trackingNumber).toBe("1Z999");

    // Already shipped — a second attempt is rejected, not silently re-applied.
    const reship = await app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/orders/items/${shipTarget.id}/ship`,
      headers: { cookie },
      payload: { trackingNumber: "OTHER" },
    });
    expect(reship.statusCode).toBe(409);

    // order.export ----
    const exportJson = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/orders/export?format=json`, headers: { cookie } });
    expect(exportJson.statusCode).toBe(200);
    const rows = exportJson.json() as Array<{ orderId: string; productId: string; trackingNumber: string | null }>;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.productId === physicalId)?.trackingNumber).toBe("1Z999");

    const exportCsv = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/orders/export?format=csv`, headers: { cookie } });
    expect(exportCsv.statusCode).toBe(200);
    expect(exportCsv.headers["content-type"]).toContain("text/csv");
    expect(exportCsv.body).toContain("orderId");

    // The post-purchase receipt endpoint (visitor-facing, no principal) ----
    const receipt = await app.inject({ method: "GET", url: `/v1/runtime/sites/${siteId}/cart-checkout/${orderId}/receipt` });
    expect(receipt.statusCode).toBe(200);
    const receiptBody = receipt.json() as { items: Array<{ productId: string; successMessage: string; fulfillmentType: string }> };
    const digitalReceiptItem = receiptBody.items.find((i) => i.productId === digitalId)!;
    expect(digitalReceiptItem.successMessage).toBe("Your download link is in your inbox.");
  });

  it("oversell: two carts race for the last unit — neither order is lost, the loser is flagged, never blocked", async () => {
    const cookie = await seedAccountAndLogin(`orders-oversell-${newUlid()}@example.com`);
    const siteId = await createSiteWithStripe(cookie);
    const productId = await createPublishedProduct(cookie, siteId, { title: "Last one", price: 1000, stockCount: 1 });

    // Both checkouts are created before either webhook lands — exactly the
    // race this feature exists for (createCartCheckout's own stock check at
    // creation time can't see the other visitor's in-flight purchase).
    const checkoutA = await app.inject({ method: "POST", url: `/v1/runtime/sites/${siteId}/cart-checkout`, payload: { items: [{ productId, quantity: 1 }] } });
    const checkoutB = await app.inject({ method: "POST", url: `/v1/runtime/sites/${siteId}/cart-checkout`, payload: { items: [{ productId, quantity: 1 }] } });
    expect(checkoutA.statusCode).toBe(201);
    expect(checkoutB.statusCode).toBe(201);
    const sessionA = sessionIdFromUrl((checkoutA.json() as { url: string }).url);
    const sessionB = sessionIdFromUrl((checkoutB.json() as { url: string }).url);

    const advanceA = await app.inject({ method: "POST", url: `/v1/dev/stripe-connect/${siteId}/cart/advance`, payload: { sessionId: sessionA } });
    const advanceB = await app.inject({ method: "POST", url: `/v1/dev/stripe-connect/${siteId}/cart/advance`, payload: { sessionId: sessionB } });
    expect(advanceA.statusCode).toBe(200);
    expect(advanceB.statusCode).toBe(200);

    const bodyA = advanceA.json() as { orderItems: Array<{ oversold: boolean }> };
    const bodyB = advanceB.json() as { orderItems: Array<{ oversold: boolean }> };
    // Exactly one of the two orders is flagged oversold — both orders exist
    // (the money was collected for both; neither is silently dropped).
    const oversoldCount = [bodyA, bodyB].filter((b) => b.orderItems[0]!.oversold).length;
    expect(oversoldCount).toBe(1);

    const stock = await app.inject({ method: "GET", url: `/v1/runtime/sites/${siteId}/products/${productId}/stock` });
    expect((stock.json() as { stockCount: number }).stockCount).toBe(0);

    const list = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/orders`, headers: { cookie } });
    expect((list.json() as { total: number }).total).toBe(2);
  });
});
