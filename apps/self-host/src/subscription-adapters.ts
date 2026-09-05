import type { SubscriptionBlockStore, SubscriptionRecordStore } from "@prefab/runtime";
import type { SelfHostDb } from "./db.js";

/** SQLite-backed halves of @prefab/runtime's KAN-1154 subscription storage interfaces (ADR-0010, ADR-0016) — the exact same interfaces apps/api/src/lib/subscription-adapters.ts implements against Postgres. `createSubscriptionCheckout` (packages/runtime/src/checkout.ts) runs completely unchanged against these. No tenant context needed — a self-hosted instance serves exactly one site (R10). `stripe_connections` is reused unchanged from payment-adapters.ts's own `createSqliteStripeConnectionStore` — no separate function needed here. */
export function createSqliteSubscriptionBlockStore(db: SelfHostDb): SubscriptionBlockStore {
  return {
    async getBlock(blockId) {
      const row = db
        .prepare<
          [string],
          {
            id: string;
            site_id: string;
            heading: string;
            description: string;
            button_label: string;
            price: number;
            currency: string;
            interval: "month" | "year";
            trial_period_days: number;
            success_message: string;
          }
        >(
          "SELECT id, site_id, heading, description, button_label, price, currency, interval, trial_period_days, success_message FROM subscription_blocks WHERE id = ?",
        )
        .get(blockId);
      if (!row) return null;
      return {
        id: row.id,
        siteId: row.site_id,
        heading: row.heading,
        description: row.description,
        buttonLabel: row.button_label,
        price: row.price,
        currency: row.currency,
        interval: row.interval,
        trialPeriodDays: row.trial_period_days,
        successMessage: row.success_message,
      };
    },
  };
}

export function createSqliteSubscriptionRecordStore(db: SelfHostDb): SubscriptionRecordStore {
  return {
    async create(input) {
      db.prepare(
        `INSERT INTO subscription_records (id, site_id, block_id, stripe_checkout_session_id, price, currency, interval, trial_period_days, created_at)
         VALUES (@id, @siteId, @blockId, @stripeCheckoutSessionId, @price, @currency, @interval, @trialPeriodDays, @createdAt)`,
      ).run({ ...input, createdAt: new Date().toISOString() });
      return { id: input.id };
    },
  };
}
