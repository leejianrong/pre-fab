import type { PoolClient } from "pg";

export type Plan = "free" | "pro";
export type SubscriptionStatus = "active" | "past_due" | "canceled";

export interface Subscription {
  id: string;
  accountId: string;
  plan: Plan;
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  gracePeriodEndsAt: Date | null;
  canceledAt: Date | null;
  retentionEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SubscriptionRow {
  id: string;
  account_id: string;
  plan: Plan;
  status: SubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  grace_period_ends_at: Date | null;
  canceled_at: Date | null;
  retention_ends_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function rowToSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    accountId: row.account_id,
    plan: row.plan,
    status: row.status,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    gracePeriodEndsAt: row.grace_period_ends_at,
    canceledAt: row.canceled_at,
    retentionEndsAt: row.retention_ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Every account is billed the moment anything needs to know its plan, not
 * only at signup — so a dev-seeded account (slice 1's `/v1/dev/login`) and
 * a real-signup account both read as an ordinary free/active row with no
 * special-casing at every call site. `ON CONFLICT DO NOTHING` plus a
 * follow-up SELECT makes the race between two concurrent first-callers
 * harmless — whichever insert wins, both callers see the same row.
 */
export async function getOrCreateSubscription(client: PoolClient, id: string, accountId: string): Promise<Subscription> {
  await client.query(
    `INSERT INTO subscriptions (id, account_id) VALUES ($1, $2) ON CONFLICT (account_id) DO NOTHING`,
    [id, accountId],
  );
  const result = await client.query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE account_id = $1`, [accountId]);
  return rowToSubscription(result.rows[0]!);
}

export async function getSubscriptionByAccountId(client: PoolClient, accountId: string): Promise<Subscription | null> {
  const result = await client.query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE account_id = $1`, [accountId]);
  return result.rows[0] ? rowToSubscription(result.rows[0]) : null;
}

/** The one lookup a Stripe webhook can do with no account_id in hand yet — that is exactly what this resolves. */
export async function getSubscriptionByStripeCustomerId(client: PoolClient, stripeCustomerId: string): Promise<Subscription | null> {
  const result = await client.query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE stripe_customer_id = $1`, [stripeCustomerId]);
  return result.rows[0] ? rowToSubscription(result.rows[0]) : null;
}

export interface SubscriptionPatch {
  plan?: Plan;
  status?: SubscriptionStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  gracePeriodEndsAt?: Date | null;
  canceledAt?: Date | null;
  retentionEndsAt?: Date | null;
}

/** Every subscription state transition (checkout completed, payment failed/succeeded, canceled) goes through this one update — see lib/subscriptions.ts's pure `applyXxx` functions for what each patch actually contains. */
export async function updateSubscription(client: PoolClient, accountId: string, patch: SubscriptionPatch): Promise<Subscription> {
  const result = await client.query<SubscriptionRow>(
    `UPDATE subscriptions SET
       plan = COALESCE($2, plan),
       status = COALESCE($3, status),
       stripe_customer_id = CASE WHEN $4::boolean THEN $5 ELSE stripe_customer_id END,
       stripe_subscription_id = CASE WHEN $6::boolean THEN $7 ELSE stripe_subscription_id END,
       grace_period_ends_at = CASE WHEN $8::boolean THEN $9 ELSE grace_period_ends_at END,
       canceled_at = CASE WHEN $10::boolean THEN $11 ELSE canceled_at END,
       retention_ends_at = CASE WHEN $12::boolean THEN $13 ELSE retention_ends_at END,
       updated_at = now()
     WHERE account_id = $1
     RETURNING *`,
    [
      accountId,
      patch.plan ?? null,
      patch.status ?? null,
      "stripeCustomerId" in patch,
      patch.stripeCustomerId ?? null,
      "stripeSubscriptionId" in patch,
      patch.stripeSubscriptionId ?? null,
      "gracePeriodEndsAt" in patch,
      patch.gracePeriodEndsAt ?? null,
      "canceledAt" in patch,
      patch.canceledAt ?? null,
      "retentionEndsAt" in patch,
      patch.retentionEndsAt ?? null,
    ],
  );
  if (!result.rows[0]) throw new Error(`subscription for account ${accountId} not found`);
  return rowToSubscription(result.rows[0]);
}

export async function recordStripeWebhookEvent(client: PoolClient, id: string, type: string): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO stripe_webhook_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [id, type],
  );
  return result.rows.length > 0;
}
