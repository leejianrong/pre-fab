import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newUlid } from "@prefab/schema";
import { createPool, runMigrations, withTenantContext } from "../src/index.js";
import { createAccount, createSite } from "../src/repositories/index.js";
import { createProduct, decrementProductStock, getProduct } from "../src/repositories/products.js";
import { createCartCheckoutRecord, getCartCheckoutRecordById, markCartCheckoutRecordCompleted } from "../src/repositories/cart-checkout-records.js";
import {
  createOrderItem,
  getOrderItem,
  listAllOrderItemsForExport,
  listOrderItemsForCartCheckoutRecord,
  markOrderItemShipped,
} from "../src/repositories/order-items.js";

const migrateUrl = process.env.MIGRATE_DATABASE_URL_TEST;
const appUrl = process.env.DATABASE_URL_TEST;

if (!migrateUrl || !appUrl) {
  throw new Error("MIGRATE_DATABASE_URL_TEST and DATABASE_URL_TEST must be set — see .env.example and scripts/db-up.sh");
}

const migratePool = createPool(migrateUrl);
const appPool = createPool(appUrl);

beforeAll(async () => {
  await runMigrations(migratePool);
});

afterAll(async () => {
  await migratePool.end();
  await appPool.end();
});

async function makeSite(prefix: string) {
  const owner = await withTenantContext(migratePool, {}, (client) =>
    createAccount(client, { id: newUlid(), email: `${prefix}-${newUlid()}@example.com` }),
  );
  const site = await withTenantContext(appPool, { accountId: owner.id }, (client) =>
    createSite(client, { id: newUlid(), slug: `${prefix}-${newUlid()}`, name: prefix, ownerId: owner.id }),
  );
  return { owner, site };
}

/**
 * KAN-1246 / ADR-0018 (part 3 addendum): repository-level coverage for the
 * pieces cart-order-webhook.ts (apps/api) composes — atomic stock decrement,
 * the cart_checkout_records 'pending' -> 'completed' idempotency guard, and
 * order_items' own fulfillment lifecycle. The webhook consumer itself
 * (dedup + transaction orchestration) has no db-package test — it belongs
 * to apps/api's own integration suite, mirrored on subscription-webhook.ts's
 * own precedent of no dedicated unit test file.
 */
describe("decrementProductStock (ADR-0018 part 3 addendum)", () => {
  it("decrements atomically when stock is sufficient — not oversold", async () => {
    const { site } = await makeSite("stock-ok");
    const product = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createProduct(client, { id: newUlid(), siteId: site.id, slug: "widget", title: "Widget", price: 1000, stockCount: 5 }),
    );

    const result = await withTenantContext(appPool, { siteId: site.id }, (client) => decrementProductStock(client, product.id, 3));
    expect(result.oversold).toBe(false);
    expect(result.document.stockCount).toBe(2);

    const reread = await withTenantContext(appPool, { siteId: site.id }, (client) => getProduct(client, product.id));
    expect(reread?.stockCount).toBe(2);
  });

  it("floors at zero and reports oversold when stock is insufficient — the payment already succeeded, so this never blocks the caller", async () => {
    const { site } = await makeSite("stock-oversold");
    const product = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createProduct(client, { id: newUlid(), siteId: site.id, slug: "last-unit", title: "Last unit", price: 1000, stockCount: 1 }),
    );

    const result = await withTenantContext(appPool, { siteId: site.id }, (client) => decrementProductStock(client, product.id, 3));
    expect(result.oversold).toBe(true);
    expect(result.document.stockCount).toBe(0);
  });

  it("never goes negative even across two racing decrements for more than remains", async () => {
    const { site } = await makeSite("stock-race");
    const product = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createProduct(client, { id: newUlid(), siteId: site.id, slug: "raced", title: "Raced", price: 1000, stockCount: 2 }),
    );

    const first = await withTenantContext(appPool, { siteId: site.id }, (client) => decrementProductStock(client, product.id, 2));
    expect(first.oversold).toBe(false);
    expect(first.document.stockCount).toBe(0);

    const second = await withTenantContext(appPool, { siteId: site.id }, (client) => decrementProductStock(client, product.id, 1));
    expect(second.oversold).toBe(true);
    expect(second.document.stockCount).toBe(0);
  });
});

describe("markCartCheckoutRecordCompleted idempotency (mirrors updatePaymentRecordStatus/completeSubscriptionCheckout)", () => {
  it("transitions 'pending' -> 'completed' exactly once — a second call is a no-op", async () => {
    const { site } = await makeSite("checkout-complete");
    const record = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createCartCheckoutRecord(client, {
        id: newUlid(),
        siteId: site.id,
        stripeSessionId: `cs_${newUlid()}`,
        items: [{ productId: newUlid(), quantity: 1, unitAmount: 500, currency: "usd", title: "Item", fulfillmentType: "physical" }],
        currency: "usd",
        amountSubtotal: 500,
        requiresShipping: true,
      }),
    );

    const first = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      markCartCheckoutRecordCompleted(client, site.id, record.stripeSessionId, { buyerEmail: "buyer@example.com" }),
    );
    expect(first?.status).toBe("completed");
    expect(first?.buyerEmail).toBe("buyer@example.com");

    // A redelivered webhook (same or a different event id) must find no row
    // to transition — the identical "AND status = 'pending'" guard
    // updatePaymentRecordStatus/completeSubscriptionCheckout already use.
    const second = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      markCartCheckoutRecordCompleted(client, site.id, record.stripeSessionId, { buyerEmail: "someone-else@example.com" }),
    );
    expect(second).toBeNull();

    const reread = await withTenantContext(appPool, { siteId: site.id }, (client) => getCartCheckoutRecordById(client, site.id, record.id));
    expect(reread?.status).toBe("completed");
    expect(reread?.buyerEmail).toBe("buyer@example.com");
  });
});

describe("order_items fulfillment lifecycle (KAN-1246)", () => {
  it("a physical line starts 'unfulfilled' and moves to 'shipped' with a tracking number, guarded against re-shipping", async () => {
    const { site } = await makeSite("order-items-physical");
    const record = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createCartCheckoutRecord(client, {
        id: newUlid(),
        siteId: site.id,
        stripeSessionId: `cs_${newUlid()}`,
        items: [],
        currency: "usd",
        amountSubtotal: 1000,
        requiresShipping: true,
      }),
    );
    const product = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createProduct(client, { id: newUlid(), siteId: site.id, slug: "shippable", title: "Shippable", price: 1000, stockCount: 10 }),
    );

    const item = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createOrderItem(client, {
        id: newUlid(),
        cartCheckoutRecordId: record.id,
        siteId: site.id,
        productId: product.id,
        quantity: 1,
        unitAmount: 1000,
        currency: "usd",
        title: product.title,
        fulfillmentType: "physical",
        status: "unfulfilled",
      }),
    );
    expect(item.status).toBe("unfulfilled");
    expect(item.oversold).toBe(false);

    const shipped = await withTenantContext(appPool, { siteId: site.id }, (client) => markOrderItemShipped(client, site.id, item.id, "TRACK123"));
    expect(shipped?.status).toBe("shipped");
    expect(shipped?.trackingNumber).toBe("TRACK123");

    // Already shipped — a second ship attempt (a stale double-click) must be a no-op, not a second real shipment.
    const reshipped = await withTenantContext(appPool, { siteId: site.id }, (client) => markOrderItemShipped(client, site.id, item.id, "TRACK999"));
    expect(reshipped).toBeNull();

    const current = await withTenantContext(appPool, { siteId: site.id }, (client) => getOrderItem(client, site.id, item.id));
    expect(current?.trackingNumber).toBe("TRACK123");
  });

  it("a digital/service line is created 'delivered' directly — never goes through markOrderItemShipped", async () => {
    const { site } = await makeSite("order-items-digital");
    const record = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createCartCheckoutRecord(client, {
        id: newUlid(),
        siteId: site.id,
        stripeSessionId: `cs_${newUlid()}`,
        items: [],
        currency: "usd",
        amountSubtotal: 2000,
        requiresShipping: false,
      }),
    );
    const product = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createProduct(client, {
        id: newUlid(),
        siteId: site.id,
        slug: "ebook",
        title: "Ebook",
        price: 2000,
        fulfillmentType: "digital_or_service",
        stockCount: null,
      }),
    );

    const item = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createOrderItem(client, {
        id: newUlid(),
        cartCheckoutRecordId: record.id,
        siteId: site.id,
        productId: product.id,
        quantity: 1,
        unitAmount: 2000,
        currency: "usd",
        title: product.title,
        fulfillmentType: "digital_or_service",
        status: "delivered",
      }),
    );
    expect(item.status).toBe("delivered");

    // 'unfulfilled' only — a delivered line matches no row.
    const attempt = await withTenantContext(appPool, { siteId: site.id }, (client) => markOrderItemShipped(client, site.id, item.id, "N/A"));
    expect(attempt).toBeNull();

    const items = await withTenantContext(appPool, { siteId: site.id }, (client) => listOrderItemsForCartCheckoutRecord(client, site.id, record.id));
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("delivered");
  });

  it("listAllOrderItemsForExport joins each line against its own order header for buyerEmail", async () => {
    const { site } = await makeSite("order-items-export");
    const record = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createCartCheckoutRecord(client, {
        id: newUlid(),
        siteId: site.id,
        stripeSessionId: `cs_${newUlid()}`,
        items: [],
        currency: "usd",
        amountSubtotal: 1500,
        requiresShipping: true,
      }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      markCartCheckoutRecordCompleted(client, site.id, record.stripeSessionId, { buyerEmail: "export-buyer@example.com" }),
    );
    const product = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createProduct(client, { id: newUlid(), siteId: site.id, slug: "export-item", title: "Export item", price: 1500, stockCount: 5 }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createOrderItem(client, {
        id: newUlid(),
        cartCheckoutRecordId: record.id,
        siteId: site.id,
        productId: product.id,
        quantity: 1,
        unitAmount: 1500,
        currency: "usd",
        title: product.title,
        fulfillmentType: "physical",
        status: "unfulfilled",
      }),
    );

    const rows = await withTenantContext(appPool, { siteId: site.id }, (client) => listAllOrderItemsForExport(client, site.id));
    const row = rows.find((r) => r.cartCheckoutRecordId === record.id);
    expect(row?.buyerEmail).toBe("export-buyer@example.com");
    expect(row?.title).toBe("Export item");
  });
});
