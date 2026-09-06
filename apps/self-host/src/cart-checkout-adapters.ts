import type { CartCheckoutRecordStore, CartProductStore } from "@prefab/runtime";
import type { SelfHostDb } from "./db.js";

/**
 * KAN-1247 / ADR-0018 (part 4 addendum): SQLite-backed halves of
 * @prefab/runtime's KAN-1245 cart-checkout storage interfaces (ADR-0010) —
 * the exact same interfaces apps/api/src/lib/cart-checkout-adapters.ts
 * implements against Postgres. `createCartCheckout` (packages/runtime/src/
 * checkout.ts) runs completely unchanged against these. No tenant context
 * needed — a self-hosted instance serves exactly one site (R10).
 */
export function createSqliteCartProductStore(db: SelfHostDb): CartProductStore {
  return {
    async getProduct(productId) {
      // Mirrors getProductPublic's own "relies entirely on the public-read
      // policy" contract — here reimplemented as a plain WHERE clause since
      // SQLite has no RLS to lean on (see schema.sql's own comment on this
      // table for the full reasoning).
      const row = db
        .prepare<
          [string],
          { id: string; site_id: string; title: string; price: number; currency: string; fulfillment_type: "physical" | "digital_or_service"; stock_count: number | null }
        >("SELECT id, site_id, title, price, currency, fulfillment_type, stock_count FROM products WHERE id = ? AND status = 'published'")
        .get(productId);
      if (!row) return null;
      return {
        id: row.id,
        siteId: row.site_id,
        title: row.title,
        price: row.price,
        currency: row.currency,
        fulfillmentType: row.fulfillment_type,
        stockCount: row.stock_count,
      };
    },
  };
}

export function createSqliteCartCheckoutRecordStore(db: SelfHostDb): CartCheckoutRecordStore {
  return {
    async create(input) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO cart_checkout_records (id, site_id, stripe_session_id, items, currency, amount_subtotal, requires_shipping, created_at, updated_at)
         VALUES (@id, @siteId, @stripeSessionId, @items, @currency, @amountSubtotal, @requiresShipping, @createdAt, @updatedAt)`,
      ).run({
        id: input.id,
        siteId: input.siteId,
        stripeSessionId: input.stripeSessionId,
        items: JSON.stringify(input.items),
        currency: input.currency,
        amountSubtotal: input.amountSubtotal,
        requiresShipping: input.requiresShipping ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      });
      return { id: input.id };
    },
  };
}
