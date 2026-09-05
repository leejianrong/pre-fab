import type { PaymentBlockStore, PaymentRecordStore, StripeConnectionStore } from "@prefab/runtime";
import type { SelfHostDb } from "./db.js";

/** SQLite-backed halves of @prefab/runtime's Slice 10 storage interfaces (ADR-0010) — the exact same interfaces apps/api/src/lib/payment-adapters.ts implements against Postgres. `createPaymentCheckout` (packages/runtime/src/checkout.ts) runs completely unchanged against these. No tenant context needed — a self-hosted instance serves exactly one site (R10). */
export function createSqlitePaymentBlockStore(db: SelfHostDb): PaymentBlockStore {
  return {
    async getBlock(blockId) {
      const row = db
        .prepare<
          [string],
          { id: string; site_id: string; heading: string; description: string; button_label: string; amount: number; currency: string; success_message: string }
        >("SELECT id, site_id, heading, description, button_label, amount, currency, success_message FROM payment_blocks WHERE id = ?")
        .get(blockId);
      if (!row) return null;
      return {
        id: row.id,
        siteId: row.site_id,
        heading: row.heading,
        description: row.description,
        buttonLabel: row.button_label,
        amount: row.amount,
        currency: row.currency,
        successMessage: row.success_message,
      };
    },
  };
}

export function createSqliteStripeConnectionStore(db: SelfHostDb): StripeConnectionStore {
  return {
    async getConnection(siteId) {
      const row = db
        .prepare<[string], { stripe_account_id: string; access_token: string; status: "connected" | "error" }>(
          "SELECT stripe_account_id, access_token, status FROM stripe_connections WHERE site_id = ?",
        )
        .get(siteId);
      if (!row) return null;
      return { stripeAccountId: row.stripe_account_id, accessToken: row.access_token, status: row.status };
    },
  };
}

export function createSqlitePaymentRecordStore(db: SelfHostDb): PaymentRecordStore {
  return {
    async create(input) {
      db.prepare(
        `INSERT INTO payment_records (id, site_id, block_id, stripe_session_id, amount, currency, created_at)
         VALUES (@id, @siteId, @blockId, @stripeSessionId, @amount, @currency, @createdAt)`,
      ).run({ ...input, createdAt: new Date().toISOString() });
      return { id: input.id };
    },
  };
}
