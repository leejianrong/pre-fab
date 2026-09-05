import type { PoolClient } from "pg";

/**
 * Stripe's OWN Subscription.status vocabulary, stored verbatim — see
 * 0012_kan1154_subscriptions.sql's header comment and ADR-0016's question 2
 * for why this is not a platform-invented enum the way
 * PaymentRecordStatus is. 'incomplete' is the only value this card's own
 * code ever writes (at checkout-session creation); every other value is
 * written only by a follow-up card's webhook handler (KAN-1154 part 2),
 * which does not exist yet.
 */
export type SubscriptionRecordStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

/** A subscription's own ongoing record — visitor PII/subscription metadata (R20), platform Postgres only, never in a site source tree. Mirrors payment-records.ts's shape, but (unlike a PaymentRecord) expected to be rewritten repeatedly over its life by part 2's webhook handler — see this module's own comment. */
export interface SubscriptionRecord {
  id: string;
  siteId: string;
  blockId: string;
  stripeCheckoutSessionId: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  /** Cents, per interval — snapshotted at creation, same "never trust the visitor" reasoning as PaymentRecord.amount. */
  price: number;
  currency: string;
  interval: "month" | "year";
  trialPeriodDays: number;
  status: SubscriptionRecordStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  buyerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawSubscriptionRecordRow {
  id: string;
  site_id: string;
  block_id: string;
  stripe_checkout_session_id: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  price: number;
  currency: string;
  interval: "month" | "year";
  trial_period_days: number;
  status: SubscriptionRecordStatus;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  canceled_at: Date | null;
  buyer_email: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToSubscriptionRecord(row: RawSubscriptionRecordRow): SubscriptionRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    blockId: row.block_id,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    price: row.price,
    currency: row.currency,
    interval: row.interval,
    trialPeriodDays: row.trial_period_days,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    canceledAt: row.canceled_at,
    buyerEmail: row.buyer_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateSubscriptionRecordInput {
  id: string;
  siteId: string;
  blockId: string;
  stripeCheckoutSessionId: string;
  price: number;
  currency: string;
  interval: "month" | "year";
  trialPeriodDays: number;
}

/**
 * The one write this card's runtime checkout endpoint makes once Stripe
 * hands back a Checkout session — created 'incomplete' (mirrors
 * createPaymentRecord's own 'pending', same "session might still be
 * abandoned" reasoning). Every subsequent transition
 * (active/trialing/past_due/canceled/...) is part 2's webhook handler's
 * job, not this function's — there is deliberately no
 * `updateSubscriptionRecordStatus` in this file yet.
 */
export async function createSubscriptionRecord(client: PoolClient, input: CreateSubscriptionRecordInput): Promise<SubscriptionRecord> {
  const result = await client.query<RawSubscriptionRecordRow>(
    `INSERT INTO subscription_records (id, site_id, block_id, stripe_checkout_session_id, price, currency, interval, trial_period_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [input.id, input.siteId, input.blockId, input.stripeCheckoutSessionId, input.price, input.currency, input.interval, input.trialPeriodDays],
  );
  return rowToSubscriptionRecord(result.rows[0]!);
}
