import type { PoolClient } from "pg";

/** The publish-safe manifest a Subscription block's props are snapshotted into on every publish — mirrors payment-blocks.ts exactly, see 0012_kan1154_subscriptions.sql's header comment and ADR-0016 for why this is a distinct table from payment_blocks. */
export interface SubscriptionBlock {
  id: string;
  siteId: string;
  heading: string;
  description: string;
  buttonLabel: string;
  /** Cents, per interval. */
  price: number;
  currency: string;
  interval: "month" | "year";
  trialPeriodDays: number;
  successMessage: string;
  createdAt: Date;
  updatedAt: Date;
}

interface RawSubscriptionBlockRow {
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
  created_at: Date;
  updated_at: Date;
}

function rowToSubscriptionBlock(row: RawSubscriptionBlockRow): SubscriptionBlock {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Called by the publish pipeline for every Subscription block on every published page — mirrors upsertPublishedPaymentBlock exactly. */
export async function upsertPublishedSubscriptionBlock(
  client: PoolClient,
  input: {
    id: string;
    siteId: string;
    heading: string;
    description: string;
    buttonLabel: string;
    price: number;
    currency: string;
    interval: "month" | "year";
    trialPeriodDays: number;
    successMessage: string;
  },
): Promise<SubscriptionBlock> {
  const result = await client.query<RawSubscriptionBlockRow>(
    `INSERT INTO subscription_blocks (id, site_id, heading, description, button_label, price, currency, interval, trial_period_days, success_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       heading = EXCLUDED.heading,
       description = EXCLUDED.description,
       button_label = EXCLUDED.button_label,
       price = EXCLUDED.price,
       currency = EXCLUDED.currency,
       interval = EXCLUDED.interval,
       trial_period_days = EXCLUDED.trial_period_days,
       success_message = EXCLUDED.success_message,
       updated_at = now()
     RETURNING *`,
    [
      input.id,
      input.siteId,
      input.heading,
      input.description,
      input.buttonLabel,
      input.price,
      input.currency,
      input.interval,
      input.trialPeriodDays,
      input.successMessage,
    ],
  );
  return rowToSubscriptionBlock(result.rows[0]!);
}

/** The runtime's only way to resolve a blockId with no tenant context — relies entirely on `subscription_blocks_public_read`. Call with `withTenantContext(pool, {})`. */
export async function getSubscriptionBlockPublic(client: PoolClient, blockId: string): Promise<SubscriptionBlock | null> {
  const result = await client.query<RawSubscriptionBlockRow>(`SELECT * FROM subscription_blocks WHERE id = $1`, [blockId]);
  return result.rows[0] ? rowToSubscriptionBlock(result.rows[0]) : null;
}
