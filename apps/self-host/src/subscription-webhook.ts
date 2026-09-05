import type { SelfHostDb } from "./db.js";
import type { EmailSubscriptionNotifier } from "./lib/subscription-notifier.js";

/**
 * KAN-1154 part 2 / ADR-0016 (R10) — a self-contained SQLite mirror of
 * apps/api/src/lib/subscription-webhook.ts (deliberately duplicated, not
 * imported — apps/self-host cannot depend on @prefab/db, which is
 * Postgres/RLS-specific control-plane code; ADR-0010/CLAUDE.md invariant
 * 4). Same state machine, same two-layer idempotency discipline (see that
 * file's own module comment for the full reasoning):
 *  1. exact redelivery — guarded by `recordStripeWebhookEvent` below
 *     against this instance's own `stripe_webhook_events` table (mirrors
 *     packages/db/migrations/0007_slice8.sql's table, added to
 *     schema.sql for exactly this reason — self-host had no webhook-event
 *     dedup table before this card, because it had no real webhook
 *     consumer of any kind before this card).
 *  2. out-of-order/different-event-id delivery — guarded by
 *     `updateSubscriptionLifecycle`'s own `fromStatuses` parameter, same
 *     as the Postgres original.
 *
 * No `withTenantContext`/RLS here at all — a self-hosted instance serves
 * exactly one site (R10), so every function below still takes `siteId`
 * (matching the schema's own column, present for parity with the
 * multi-tenant shape) but there is no tenant isolation to enforce.
 */

export interface SubscriptionRecordRow {
  id: string;
  siteId: string;
  blockId: string;
  stripeCheckoutSessionId: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  price: number;
  currency: string;
  interval: "month" | "year";
  trialPeriodDays: number;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  buyerEmail: string | null;
}

interface RawRow {
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
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: number;
  canceled_at: string | null;
  buyer_email: string | null;
}

function rowToRecord(row: RawRow): SubscriptionRecordRow {
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
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    canceledAt: row.canceled_at,
    buyerEmail: row.buyer_email,
  };
}

/** Mirrors packages/db/src/repositories/subscriptions.ts's own recordStripeWebhookEvent exactly (INSERT ... ON CONFLICT DO NOTHING, "did this row actually get inserted" as the dedup signal). */
export function recordStripeWebhookEvent(db: SelfHostDb, id: string, type: string): boolean {
  const result = db
    .prepare(`INSERT INTO stripe_webhook_events (id, type, processed_at) VALUES (@id, @type, @processedAt) ON CONFLICT (id) DO NOTHING`)
    .run({ id, type, processedAt: new Date().toISOString() });
  return result.changes > 0;
}

export function getSubscriptionRecordByStripeSubscriptionId(db: SelfHostDb, siteId: string, stripeSubscriptionId: string): SubscriptionRecordRow | null {
  const row = db.prepare<[string, string], RawRow>("SELECT * FROM subscription_records WHERE site_id = ? AND stripe_subscription_id = ?").get(siteId, stripeSubscriptionId);
  return row ? rowToRecord(row) : null;
}

export interface CompleteSubscriptionCheckoutPatch {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  buyerEmail: string | null;
  currentPeriodEnd: string | null;
}

/** Mirrors packages/db/src/repositories/subscription-records.ts's own completeSubscriptionCheckout exactly, including computing active-vs-trialing from the row's own already-stored trial_period_days (see that function's own comment for why). */
export function completeSubscriptionCheckout(
  db: SelfHostDb,
  siteId: string,
  stripeCheckoutSessionId: string,
  patch: CompleteSubscriptionCheckoutPatch,
): SubscriptionRecordRow | null {
  const result = db
    .prepare(
      `UPDATE subscription_records SET
         status = CASE WHEN trial_period_days > 0 THEN 'trialing' ELSE 'active' END,
         stripe_subscription_id = @stripeSubscriptionId,
         stripe_customer_id = @stripeCustomerId,
         buyer_email = COALESCE(@buyerEmail, buyer_email),
         current_period_end = COALESCE(@currentPeriodEnd, current_period_end)
       WHERE site_id = @siteId AND stripe_checkout_session_id = @stripeCheckoutSessionId AND status = 'incomplete'`,
    )
    .run({
      stripeSubscriptionId: patch.stripeSubscriptionId,
      stripeCustomerId: patch.stripeCustomerId,
      buyerEmail: patch.buyerEmail,
      currentPeriodEnd: patch.currentPeriodEnd,
      siteId,
      stripeCheckoutSessionId,
    });
  if (result.changes === 0) return null;
  const row = db.prepare<[string, string], RawRow>("SELECT * FROM subscription_records WHERE site_id = ? AND stripe_checkout_session_id = ?").get(siteId, stripeCheckoutSessionId);
  return row ? rowToRecord(row) : null;
}

export interface SubscriptionLifecyclePatch {
  status: string;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: string | null;
}

/** Mirrors packages/db/src/repositories/subscription-records.ts's own updateSubscriptionLifecycle exactly — see that function's own comment for the tri-state (`undefined` = "leave this column alone") and `fromStatuses` reasoning. better-sqlite3 has no array binding, so `fromStatuses` is spliced into positional `?` placeholders rather than passed as one bound value. */
export function updateSubscriptionLifecycle(
  db: SelfHostDb,
  siteId: string,
  stripeSubscriptionId: string,
  patch: SubscriptionLifecyclePatch,
  fromStatuses: string[],
): SubscriptionRecordRow | null {
  const placeholders = fromStatuses.map(() => "?").join(", ");
  const result = db
    .prepare(
      `UPDATE subscription_records SET
         status = ?,
         current_period_end = CASE WHEN ? THEN ? ELSE current_period_end END,
         cancel_at_period_end = CASE WHEN ? THEN ? ELSE cancel_at_period_end END,
         canceled_at = CASE WHEN ? THEN ? ELSE canceled_at END
       WHERE site_id = ? AND stripe_subscription_id = ? AND status IN (${placeholders})`,
    )
    .run(
      patch.status,
      patch.currentPeriodEnd !== undefined ? 1 : 0,
      patch.currentPeriodEnd ?? null,
      patch.cancelAtPeriodEnd !== undefined ? 1 : 0,
      patch.cancelAtPeriodEnd !== undefined ? (patch.cancelAtPeriodEnd ? 1 : 0) : null,
      patch.canceledAt !== undefined ? 1 : 0,
      patch.canceledAt ?? null,
      siteId,
      stripeSubscriptionId,
      ...fromStatuses,
    );
  if (result.changes === 0) return null;
  return getSubscriptionRecordByStripeSubscriptionId(db, siteId, stripeSubscriptionId);
}

export type SubscriptionWebhookOutcome = { status: "applied"; record: SubscriptionRecordRow } | { status: "deduped" } | { status: "no_match" };

interface Deps {
  db: SelfHostDb;
  notifier: EmailSubscriptionNotifier;
  /** Operator-configured (BOOKING_OWNER_EMAIL-equivalent) — see app.ts's own `ownerEmail`. `null` means silently skip every notification, same discipline as bookings/forms. */
  ownerEmail: string | null;
}

async function notifyOwner(deps: Deps, notify: (ownerEmail: string) => Promise<void>): Promise<void> {
  if (!deps.ownerEmail) return;
  await notify(deps.ownerEmail).catch(() => {});
}

export async function applySubscriptionCheckoutCompleted(
  eventId: string,
  input: { siteId: string; stripeCheckoutSessionId: string; stripeSubscriptionId: string; stripeCustomerId: string; buyerEmail: string | null; currentPeriodEnd: string | null },
  deps: Deps,
): Promise<SubscriptionWebhookOutcome> {
  if (!recordStripeWebhookEvent(deps.db, eventId, "checkout.session.completed")) return { status: "deduped" };
  const updated = completeSubscriptionCheckout(deps.db, input.siteId, input.stripeCheckoutSessionId, {
    stripeSubscriptionId: input.stripeSubscriptionId,
    stripeCustomerId: input.stripeCustomerId,
    buyerEmail: input.buyerEmail,
    currentPeriodEnd: input.currentPeriodEnd,
  });
  if (!updated) return { status: "no_match" };
  await notifyOwner(deps, (ownerEmail) =>
    deps.notifier.notifyStarted({ ownerEmail, price: updated.price, currency: updated.currency, interval: updated.interval, trialing: updated.status === "trialing", buyerEmail: updated.buyerEmail }),
  );
  return { status: "applied", record: updated };
}

export async function applyInvoicePaid(eventId: string, input: { siteId: string; stripeSubscriptionId: string }, deps: Deps): Promise<SubscriptionWebhookOutcome> {
  if (!recordStripeWebhookEvent(deps.db, eventId, "invoice.paid")) return { status: "deduped" };
  const before = getSubscriptionRecordByStripeSubscriptionId(deps.db, input.siteId, input.stripeSubscriptionId);
  const updated = updateSubscriptionLifecycle(deps.db, input.siteId, input.stripeSubscriptionId, { status: "active" }, ["trialing", "active", "past_due"]);
  if (!updated) return { status: "no_match" };
  if (before?.status === "past_due") {
    await notifyOwner(deps, (ownerEmail) => deps.notifier.notifyRecovered({ ownerEmail, buyerEmail: updated.buyerEmail }));
  }
  return { status: "applied", record: updated };
}

export async function applyInvoicePaymentFailed(eventId: string, input: { siteId: string; stripeSubscriptionId: string }, deps: Deps): Promise<SubscriptionWebhookOutcome> {
  if (!recordStripeWebhookEvent(deps.db, eventId, "invoice.payment_failed")) return { status: "deduped" };
  const updated = updateSubscriptionLifecycle(deps.db, input.siteId, input.stripeSubscriptionId, { status: "past_due" }, ["trialing", "active", "past_due"]);
  if (!updated) return { status: "no_match" };
  await notifyOwner(deps, (ownerEmail) => deps.notifier.notifyPastDue({ ownerEmail, buyerEmail: updated.buyerEmail }));
  return { status: "applied", record: updated };
}

const KNOWN_SUBSCRIPTION_STATUSES = ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"];

export async function applySubscriptionUpdated(
  eventId: string,
  input: { siteId: string; stripeSubscriptionId: string; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; canceledAt: string | null },
  deps: Deps,
): Promise<SubscriptionWebhookOutcome> {
  if (!KNOWN_SUBSCRIPTION_STATUSES.includes(input.status)) return { status: "no_match" };
  if (!recordStripeWebhookEvent(deps.db, eventId, "customer.subscription.updated")) return { status: "deduped" };
  const updated = updateSubscriptionLifecycle(
    deps.db,
    input.siteId,
    input.stripeSubscriptionId,
    { status: input.status, currentPeriodEnd: input.currentPeriodEnd, cancelAtPeriodEnd: input.cancelAtPeriodEnd, canceledAt: input.canceledAt },
    ["incomplete", "trialing", "active", "past_due", "unpaid", "paused"],
  );
  if (!updated) return { status: "no_match" };
  if (updated.status === "past_due") {
    await notifyOwner(deps, (ownerEmail) => deps.notifier.notifyPastDue({ ownerEmail, buyerEmail: updated.buyerEmail }));
  } else if (updated.status === "canceled" || updated.status === "unpaid") {
    await notifyOwner(deps, (ownerEmail) => deps.notifier.notifyCanceled({ ownerEmail, buyerEmail: updated.buyerEmail }));
  }
  return { status: "applied", record: updated };
}

export async function applySubscriptionDeleted(eventId: string, input: { siteId: string; stripeSubscriptionId: string; canceledAt: string }, deps: Deps): Promise<SubscriptionWebhookOutcome> {
  if (!recordStripeWebhookEvent(deps.db, eventId, "customer.subscription.deleted")) return { status: "deduped" };
  const updated = updateSubscriptionLifecycle(
    deps.db,
    input.siteId,
    input.stripeSubscriptionId,
    { status: "canceled", canceledAt: input.canceledAt },
    ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "unpaid", "paused"],
  );
  if (!updated) return { status: "no_match" };
  await notifyOwner(deps, (ownerEmail) => deps.notifier.notifyCanceled({ ownerEmail, buyerEmail: updated.buyerEmail }));
  return { status: "applied", record: updated };
}

/** Mirrors apps/api's own extractSubscriptionEventContext exactly — see that function's own comment for the full UNVERIFIED/multi-API-version reasoning this trims. */
export function extractSubscriptionEventContext(eventType: string, object: Record<string, unknown>): { siteId: string | null; stripeSubscriptionId: string | null } {
  if (eventType === "customer.subscription.updated" || eventType === "customer.subscription.deleted") {
    const metadata = object.metadata as { siteId?: string } | undefined;
    return { siteId: metadata?.siteId ?? null, stripeSubscriptionId: (object.id as string | undefined) ?? null };
  }
  const legacyDetails = object.subscription_details as { subscription?: string; metadata?: { siteId?: string } } | undefined;
  const parent = object.parent as { subscription_details?: { subscription?: string; metadata?: { siteId?: string } } } | undefined;
  const stripeSubscriptionId = (object.subscription as string | undefined) ?? legacyDetails?.subscription ?? parent?.subscription_details?.subscription ?? null;
  const siteId = legacyDetails?.metadata?.siteId ?? parent?.subscription_details?.metadata?.siteId ?? null;
  return { siteId, stripeSubscriptionId };
}
