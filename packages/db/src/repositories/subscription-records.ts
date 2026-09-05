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

/** By its own row id — the runtime checkout endpoint's own `id` (also `stripe_checkout_session_id`'s counterpart client_reference_id/metadata.subscriptionRecordId at Checkout-creation time), not otherwise needed by the webhook path below (which resolves by session/subscription id instead) but useful to callers (tests, a future owner-facing single-record read) that already hold it. */
export async function getSubscriptionRecordById(client: PoolClient, siteId: string, id: string): Promise<SubscriptionRecord | null> {
  const result = await client.query<RawSubscriptionRecordRow>(`SELECT * FROM subscription_records WHERE site_id = $1 AND id = $2`, [siteId, id]);
  return result.rows[0] ? rowToSubscriptionRecord(result.rows[0]) : null;
}

/** Resolved by the real webhook (customer.subscription.updated/.deleted/invoice.paid/invoice.payment_failed events all carry a subscription id, never our own row id) and by dev-advance, both of which already know siteId before ever touching this table (R20 / RLS) — same "caller already resolved tenant context" discipline as getPaymentRecordBySessionId. */
export async function getSubscriptionRecordByStripeSubscriptionId(
  client: PoolClient,
  siteId: string,
  stripeSubscriptionId: string,
): Promise<SubscriptionRecord | null> {
  const result = await client.query<RawSubscriptionRecordRow>(`SELECT * FROM subscription_records WHERE site_id = $1 AND stripe_subscription_id = $2`, [
    siteId,
    stripeSubscriptionId,
  ]);
  return result.rows[0] ? rowToSubscriptionRecord(result.rows[0]) : null;
}

export interface CompleteSubscriptionCheckoutPatch {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  buyerEmail: string | null;
  currentPeriodEnd: Date | null;
}

/**
 * KAN-1154 part 2 / ADR-0016: `checkout.session.completed` for a
 * subscription-mode session — the ONE transition keyed by
 * `stripe_checkout_session_id` rather than `stripe_subscription_id`, because
 * that column doesn't exist until this very write populates it (mirrors
 * why `createSubscriptionRecord` above snapshots the checkout session id at
 * creation time, before Stripe has ever heard of a Subscription object).
 *
 * The resulting status (`active` vs `trialing`) is computed from THIS ROW'S
 * OWN already-stored `trial_period_days` (set at checkout-session-creation
 * time from the block's own publish-safe snapshot — see
 * packages/runtime/src/checkout.ts), never re-derived from the Checkout
 * Session event payload itself: `checkout.session.completed`'s own object
 * does not reliably carry the resulting Subscription's status without an
 * explicit `expand`, and this repo already knows the trial length it asked
 * Stripe for — asking the event payload to confirm what we already told
 * Stripe to do would be trusting an unverified adapter's read of an
 * uncertain field shape for a fact this row has never needed a webhook to
 * know.
 *
 * Guarded to only ever fire `WHERE status = 'incomplete'` — the identical
 * "AND status = 'pending'" idempotency discipline
 * `updatePaymentRecordStatus` documents on its own comment: a
 * duplicate/replayed delivery after the row has already moved on returns no
 * row, so the caller's `if (updated)` naturally skips a second notification.
 */
export async function completeSubscriptionCheckout(
  client: PoolClient,
  siteId: string,
  stripeCheckoutSessionId: string,
  patch: CompleteSubscriptionCheckoutPatch,
): Promise<SubscriptionRecord | null> {
  const result = await client.query<RawSubscriptionRecordRow>(
    `UPDATE subscription_records SET
       status = CASE WHEN trial_period_days > 0 THEN 'trialing' ELSE 'active' END,
       stripe_subscription_id = $1,
       stripe_customer_id = $2,
       buyer_email = COALESCE($3, buyer_email),
       current_period_end = COALESCE($4, current_period_end),
       updated_at = now()
     WHERE site_id = $5 AND stripe_checkout_session_id = $6 AND status = 'incomplete'
     RETURNING *`,
    [patch.stripeSubscriptionId, patch.stripeCustomerId, patch.buyerEmail, patch.currentPeriodEnd, siteId, stripeCheckoutSessionId],
  );
  return result.rows[0] ? rowToSubscriptionRecord(result.rows[0]) : null;
}

export interface SubscriptionLifecyclePatch {
  /** Written verbatim — ADR-0016's question 2: Stripe's own status vocabulary, never a platform-invented translation. */
  status: SubscriptionRecordStatus;
  /** `undefined` means "leave this column alone" (tri-state, not nullable-means-clear) — a CASE/boolean-flag pair per field below carries that distinction through to SQL, since `COALESCE($x, col)` cannot tell "explicitly null" apart from "not provided" the way a plain object shape can. */
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
}

/**
 * KAN-1154 part 2 / ADR-0016: every lifecycle transition AFTER
 * `checkout.session.completed` funnels through here —
 * `invoice.paid`/`invoice.payment_failed`/`customer.subscription.updated`/
 * `customer.subscription.deleted` all resolve to one (patch, fromStatuses)
 * pair each (see apps/api/src/lib/subscription-webhook.ts and its
 * apps/self-host mirror for exactly which). Keyed by
 * `stripe_subscription_id`, populated only once `completeSubscriptionCheckout`
 * above has already run for this row.
 *
 * `fromStatuses` is the state machine's own documented set of valid
 * predecessor states for whichever transition the caller is applying — this
 * is what makes a stale/out-of-order event safe: a delayed `invoice.paid`
 * arriving after a `customer.subscription.deleted` already set
 * `status = 'canceled'` matches no row here (`fromStatuses` for
 * `invoice.paid` never includes `'canceled'`), so this returns `null` and
 * the caller's `if (updated)` guard skips both the write and the
 * notification — the same "no row updated -> no side effect" discipline
 * `updatePaymentRecordStatus`/`completeSubscriptionCheckout` above use, just
 * with a caller-supplied predecessor set instead of a single hard-coded one
 * (`payment_records` only ever has one transition to guard; this table has
 * several).
 */
export async function updateSubscriptionLifecycle(
  client: PoolClient,
  siteId: string,
  stripeSubscriptionId: string,
  patch: SubscriptionLifecyclePatch,
  fromStatuses: SubscriptionRecordStatus[],
): Promise<SubscriptionRecord | null> {
  const result = await client.query<RawSubscriptionRecordRow>(
    `UPDATE subscription_records SET
       status = $1,
       current_period_end = CASE WHEN $2::boolean THEN $3 ELSE current_period_end END,
       cancel_at_period_end = CASE WHEN $4::boolean THEN $5 ELSE cancel_at_period_end END,
       canceled_at = CASE WHEN $6::boolean THEN $7 ELSE canceled_at END,
       updated_at = now()
     WHERE site_id = $8 AND stripe_subscription_id = $9 AND status = ANY($10::text[])
     RETURNING *`,
    [
      patch.status,
      patch.currentPeriodEnd !== undefined,
      patch.currentPeriodEnd ?? null,
      patch.cancelAtPeriodEnd !== undefined,
      patch.cancelAtPeriodEnd ?? null,
      patch.canceledAt !== undefined,
      patch.canceledAt ?? null,
      siteId,
      stripeSubscriptionId,
      fromStatuses,
    ],
  );
  return result.rows[0] ? rowToSubscriptionRecord(result.rows[0]) : null;
}

export interface ListSubscriptionRecordsOptions {
  /** Clamped to [1, 200]. Default 50. */
  limit?: number;
  /** Clamped to >= 0. Default 0. */
  offset?: number;
}

export interface ListSubscriptionRecordsResult {
  records: SubscriptionRecord[];
  total: number;
}

const SUBSCRIPTION_DEFAULT_LIMIT = 50;
const SUBSCRIPTION_MAX_LIMIT = 200;

/** The owner-facing dashboard read — mirrors listPaymentRecordsForSite exactly (point 3, KAN-1154 part 2: a data-access surface consistent with the existing one-off pattern, not a new dashboard screen). */
export async function listSubscriptionRecordsForSite(
  client: PoolClient,
  siteId: string,
  blockId: string,
  options: ListSubscriptionRecordsOptions = {},
): Promise<ListSubscriptionRecordsResult> {
  const limit = Math.min(SUBSCRIPTION_MAX_LIMIT, Math.max(1, Math.trunc(options.limit ?? SUBSCRIPTION_DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));

  const countResult = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM subscription_records WHERE site_id = $1 AND block_id = $2`,
    [siteId, blockId],
  );
  const rowsResult = await client.query<RawSubscriptionRecordRow>(
    `SELECT * FROM subscription_records WHERE site_id = $1 AND block_id = $2 ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
    [siteId, blockId, limit, offset],
  );

  return { records: rowsResult.rows.map(rowToSubscriptionRecord), total: Number(countResult.rows[0]!.count) };
}
