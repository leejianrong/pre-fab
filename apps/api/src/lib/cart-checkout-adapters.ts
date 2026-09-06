import { createCartCheckoutRecord as dbCreateCartCheckoutRecord, getProductPublic, withTenantContext, type Pool } from "@prefab/db";
import type { CartCheckoutRecordStore, CartProductStore } from "@prefab/runtime";

/**
 * The Postgres-backed halves of @prefab/runtime's KAN-1245 cart-checkout
 * storage interfaces (ADR-0010, ADR-0018 cart addendum) — apps/api is the
 * control plane, so it's the one place allowed to know these are backed by
 * Postgres/@prefab/db at all. Mirrors payment-adapters.ts/
 * subscription-adapters.ts (a new file, not a branch inside either — a cart
 * checkout is its own kind of thing, see the ADR addendum's point 2).
 */
export function createPostgresCartProductStore(pool: Pool): CartProductStore {
  return {
    async getProduct(productId) {
      const product = await withTenantContext(pool, {}, (client) => getProductPublic(client, productId));
      if (!product) return null;
      return {
        id: product.id,
        siteId: product.siteId,
        title: product.title,
        price: product.price,
        currency: product.currency,
        fulfillmentType: product.fulfillmentType,
        stockCount: product.stockCount,
      };
    },
  };
}

export function createPostgresCartCheckoutRecordStore(pool: Pool): CartCheckoutRecordStore {
  return {
    async create(input) {
      const record = await withTenantContext(pool, { siteId: input.siteId }, (client) =>
        dbCreateCartCheckoutRecord(client, {
          id: input.id,
          siteId: input.siteId,
          stripeSessionId: input.stripeSessionId,
          items: input.items,
          currency: input.currency,
          amountSubtotal: input.amountSubtotal,
          requiresShipping: input.requiresShipping,
        }),
      );
      return { id: record.id };
    },
  };
}
