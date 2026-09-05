import { createSubscriptionRecord as dbCreateSubscriptionRecord, getSubscriptionBlockPublic, withTenantContext, type Pool } from "@prefab/db";
import type { SubscriptionBlockStore, SubscriptionRecordStore } from "@prefab/runtime";

/**
 * The Postgres-backed halves of @prefab/runtime's KAN-1154 subscription
 * storage interfaces (ADR-0010, ADR-0016) — apps/api is the control plane,
 * so it's the one place allowed to know these are backed by Postgres/
 * @prefab/db at all. Mirrors payment-adapters.ts exactly (a new file, not a
 * branch inside that one — see ADR-0016's own consequences section for
 * why).
 */
export function createPostgresSubscriptionBlockStore(pool: Pool): SubscriptionBlockStore {
  return {
    async getBlock(blockId) {
      const block = await withTenantContext(pool, {}, (client) => getSubscriptionBlockPublic(client, blockId));
      if (!block) return null;
      return {
        id: block.id,
        siteId: block.siteId,
        heading: block.heading,
        description: block.description,
        buttonLabel: block.buttonLabel,
        price: block.price,
        currency: block.currency,
        interval: block.interval,
        trialPeriodDays: block.trialPeriodDays,
        successMessage: block.successMessage,
      };
    },
  };
}

/** `stripe_connections` is shared with the one-off payment path unchanged — see ADR-0016's own reasoning (a connected Stripe account is the same account whether charged once or on a schedule). Wiring apps/api's own `createPostgresStripeConnectionStore` (payment-adapters.ts) into `createSubscriptionCheckout`'s deps works with no change needed here; this file adds no separate function for it. */
export function createPostgresSubscriptionRecordStore(pool: Pool): SubscriptionRecordStore {
  return {
    async create(input) {
      const record = await withTenantContext(pool, { siteId: input.siteId }, (client) =>
        dbCreateSubscriptionRecord(client, {
          id: input.id,
          siteId: input.siteId,
          blockId: input.blockId,
          stripeCheckoutSessionId: input.stripeCheckoutSessionId,
          price: input.price,
          currency: input.currency,
          interval: input.interval,
          trialPeriodDays: input.trialPeriodDays,
        }),
      );
      return { id: record.id };
    },
  };
}
