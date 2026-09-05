import type { Pool } from "pg";
import {
  withTenantContext,
  recordStripeWebhookEvent,
  completeSubscriptionCheckout,
  updateSubscriptionLifecycle,
  getSubscriptionRecordByStripeSubscriptionId,
  getSite,
  getAccount,
  type SubscriptionRecord,
  type SubscriptionRecordStatus,
} from "@prefab/db";
import type { EmailSubscriptionNotifier } from "./subscription-notifier.js";

/**
 * KAN-1154 part 2 / ADR-0016: the whole subscription lifecycle state
 * machine ADR-0016's "question 2" documents, applied against
 * `subscription_records` — shared by BOTH the real, signature-verified
 * `/v1/webhooks/stripe-connect` route and the dev-only
 * `/v1/dev/stripe-connect/:siteId/subscriptions/advance` route (see
 * app.ts), so the two can never disagree about what a given event does.
 * The dev-advance route hands these functions already-extracted fields
 * (it constructs the event itself); the real webhook route has to first
 * dig them out of Stripe's own payload shapes — see
 * `extractSubscriptionEventContext` at the bottom of this file for that
 * part, used only by the real webhook branch.
 *
 * Idempotency, two layers (see ADR-0016 addendum + this card's PR body for
 * the full reasoning):
 *  1. **Exact redelivery** (Stripe retries an event it didn't get a fast
 *     2xx for — the same `event.id` twice): guarded by
 *     `recordStripeWebhookEvent`, the identical `stripe_webhook_events`
 *     table Slice 8's platform-billing webhook already uses (a global,
 *     not per-tenant, table — Stripe event ids are globally unique
 *     regardless of which integration receives them, so reusing it here
 *     needs no new table). A duplicate returns `{ status: "deduped" }`
 *     with no further write and no notification.
 *  2. **Out-of-order / duplicate-but-different-event-id delivery** (e.g. a
 *     delayed `invoice.paid` arriving after a LATER
 *     `customer.subscription.deleted` already processed): guarded by
 *     `updateSubscriptionLifecycle`'s own `fromStatuses` parameter — a
 *     transition whose precondition the row's CURRENT status no longer
 *     satisfies matches no row, returns `null`, and this module's
 *     `if (updated)` guards skip both any further write and the
 *     notification. This is the layer `recordStripeWebhookEvent` alone
 *     cannot provide: two DIFFERENT event ids delivered out of order are
 *     not duplicates by id, but one of them must still lose.
 */

export type SubscriptionWebhookOutcome =
  | { status: "applied"; record: SubscriptionRecord }
  | { status: "deduped" }
  | { status: "no_match" };

interface Deps {
  pool: Pool;
  notifier: EmailSubscriptionNotifier;
}

async function notifyOwner(pool: Pool, siteId: string, notify: (owner: { email: string }) => Promise<void>): Promise<void> {
  const site = await withTenantContext(pool, { siteId }, (client) => getSite(client, siteId));
  const owner = site ? await withTenantContext(pool, {}, (client) => getAccount(client, site.ownerId)) : null;
  if (owner?.email) {
    await notify({ email: owner.email }).catch(() => {});
  }
}

/** `checkout.session.completed` (subscription-mode session) → `active` or `trialing` (computed from the row's own already-stored `trial_period_days`, see completeSubscriptionCheckout's own comment). */
export async function applySubscriptionCheckoutCompleted(
  eventId: string,
  input: { siteId: string; stripeCheckoutSessionId: string; stripeSubscriptionId: string; stripeCustomerId: string; buyerEmail: string | null; currentPeriodEnd: Date | null },
  deps: Deps,
): Promise<SubscriptionWebhookOutcome> {
  const isNewEvent = await withTenantContext(deps.pool, {}, (client) => recordStripeWebhookEvent(client, eventId, "checkout.session.completed"));
  if (!isNewEvent) return { status: "deduped" };

  const updated = await withTenantContext(deps.pool, { siteId: input.siteId }, (client) =>
    completeSubscriptionCheckout(client, input.siteId, input.stripeCheckoutSessionId, {
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeCustomerId: input.stripeCustomerId,
      buyerEmail: input.buyerEmail,
      currentPeriodEnd: input.currentPeriodEnd,
    }),
  );
  if (!updated) return { status: "no_match" };

  await notifyOwner(deps.pool, input.siteId, (owner) =>
    deps.notifier.notifyStarted({
      ownerEmail: owner.email,
      price: updated.price,
      currency: updated.currency,
      interval: updated.interval,
      trialing: updated.status === "trialing",
      buyerEmail: updated.buyerEmail,
    }),
  );
  return { status: "applied", record: updated };
}

/** `invoice.paid` → `active` (first invoice after a trial, or dunning recovering, or an ordinary renewal — all three land on the same target status, per ADR-0016's state machine). Never fires from `incomplete`/`incomplete_expired`/`canceled`/`unpaid`/`paused`. */
export async function applyInvoicePaid(
  eventId: string,
  input: { siteId: string; stripeSubscriptionId: string },
  deps: Deps,
): Promise<SubscriptionWebhookOutcome> {
  const isNewEvent = await withTenantContext(deps.pool, {}, (client) => recordStripeWebhookEvent(client, eventId, "invoice.paid"));
  if (!isNewEvent) return { status: "deduped" };

  const wasPastDue = await getCurrentStatus(deps.pool, input.siteId, input.stripeSubscriptionId);
  const updated = await withTenantContext(deps.pool, { siteId: input.siteId }, (client) =>
    updateSubscriptionLifecycle(client, input.siteId, input.stripeSubscriptionId, { status: "active" }, ["trialing", "active", "past_due"]),
  );
  if (!updated) return { status: "no_match" };

  // A recovery (past_due -> active) is the one invoice.paid outcome worth
  // an owner notification — a trial converting or an ordinary renewal is
  // not news the way "you were about to lose this subscriber and didn't"
  // is. Deliberately silent for the other two starting states.
  if (wasPastDue === "past_due") {
    await notifyOwner(deps.pool, input.siteId, (owner) => deps.notifier.notifyRecovered({ ownerEmail: owner.email, buyerEmail: updated.buyerEmail }));
  }
  return { status: "applied", record: updated };
}

/** `invoice.payment_failed` → `past_due`. Never fires from `incomplete`/`incomplete_expired`/`canceled`/`unpaid`/`paused`. */
export async function applyInvoicePaymentFailed(
  eventId: string,
  input: { siteId: string; stripeSubscriptionId: string },
  deps: Deps,
): Promise<SubscriptionWebhookOutcome> {
  const isNewEvent = await withTenantContext(deps.pool, {}, (client) => recordStripeWebhookEvent(client, eventId, "invoice.payment_failed"));
  if (!isNewEvent) return { status: "deduped" };

  const updated = await withTenantContext(deps.pool, { siteId: input.siteId }, (client) =>
    updateSubscriptionLifecycle(client, input.siteId, input.stripeSubscriptionId, { status: "past_due" }, ["trialing", "active", "past_due"]),
  );
  if (!updated) return { status: "no_match" };

  await notifyOwner(deps.pool, input.siteId, (owner) => deps.notifier.notifyPastDue({ ownerEmail: owner.email, buyerEmail: updated.buyerEmail }));
  return { status: "applied", record: updated };
}

const KNOWN_SUBSCRIPTION_STATUSES: SubscriptionRecordStatus[] = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
];

/** `customer.subscription.updated` → whatever Stripe's own `status` field says, stored verbatim (ADR-0016's question 2), plus `current_period_end`/`cancel_at_period_end` — the two columns 0012_kan1154_subscriptions.sql added specifically for this event. Never fires once the row is already `canceled`/`incomplete_expired` (both terminal — see ADR-0016's state machine). */
export async function applySubscriptionUpdated(
  eventId: string,
  input: { siteId: string; stripeSubscriptionId: string; status: string; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; canceledAt: Date | null },
  deps: Deps,
): Promise<SubscriptionWebhookOutcome> {
  if (!KNOWN_SUBSCRIPTION_STATUSES.includes(input.status as SubscriptionRecordStatus)) return { status: "no_match" };

  const isNewEvent = await withTenantContext(deps.pool, {}, (client) => recordStripeWebhookEvent(client, eventId, "customer.subscription.updated"));
  if (!isNewEvent) return { status: "deduped" };

  const updated = await withTenantContext(deps.pool, { siteId: input.siteId }, (client) =>
    updateSubscriptionLifecycle(
      client,
      input.siteId,
      input.stripeSubscriptionId,
      { status: input.status as SubscriptionRecordStatus, currentPeriodEnd: input.currentPeriodEnd, cancelAtPeriodEnd: input.cancelAtPeriodEnd, canceledAt: input.canceledAt },
      ["incomplete", "trialing", "active", "past_due", "unpaid", "paused"],
    ),
  );
  if (!updated) return { status: "no_match" };

  if (updated.status === "past_due") {
    await notifyOwner(deps.pool, input.siteId, (owner) => deps.notifier.notifyPastDue({ ownerEmail: owner.email, buyerEmail: updated.buyerEmail }));
  } else if (updated.status === "canceled" || updated.status === "unpaid") {
    await notifyOwner(deps.pool, input.siteId, (owner) => deps.notifier.notifyCanceled({ ownerEmail: owner.email, buyerEmail: updated.buyerEmail }));
  }
  return { status: "applied", record: updated };
}

/** `customer.subscription.deleted` → `canceled` [terminal]. Fires from any non-terminal state — the one event this state machine treats as authoritative regardless of where the row was (ADR-0016: "active/past_due/trialing -> canceled"). Guarded against re-firing once already `canceled` so a redelivery-with-a-different-event-id (not caught by the `recordStripeWebhookEvent` dedup above) can't re-notify or stomp an already-set `canceled_at`. */
export async function applySubscriptionDeleted(
  eventId: string,
  input: { siteId: string; stripeSubscriptionId: string; canceledAt: Date },
  deps: Deps,
): Promise<SubscriptionWebhookOutcome> {
  const isNewEvent = await withTenantContext(deps.pool, {}, (client) => recordStripeWebhookEvent(client, eventId, "customer.subscription.deleted"));
  if (!isNewEvent) return { status: "deduped" };

  const updated = await withTenantContext(deps.pool, { siteId: input.siteId }, (client) =>
    updateSubscriptionLifecycle(
      client,
      input.siteId,
      input.stripeSubscriptionId,
      { status: "canceled", canceledAt: input.canceledAt },
      ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "unpaid", "paused"],
    ),
  );
  if (!updated) return { status: "no_match" };

  await notifyOwner(deps.pool, input.siteId, (owner) => deps.notifier.notifyCanceled({ ownerEmail: owner.email, buyerEmail: updated.buyerEmail }));
  return { status: "applied", record: updated };
}

async function getCurrentStatus(pool: Pool, siteId: string, stripeSubscriptionId: string): Promise<SubscriptionRecordStatus | null> {
  const record = await withTenantContext(pool, { siteId }, (client) => getSubscriptionRecordByStripeSubscriptionId(client, siteId, stripeSubscriptionId));
  return record?.status ?? null;
}

/**
 * Best-effort extraction of `siteId`/`stripe_subscription_id` from a real
 * Stripe event's own payload — used only by the real, signature-verified
 * webhook route (dev-advance hands these fields in directly, since it
 * constructs the simulated event itself and has no payload to parse).
 *
 * UNVERIFIED against a live Stripe account (see tenant-stripe-provider.ts's
 * module comment) — written defensively against more than one Stripe API
 * version's documented shape, because this repo cannot exercise a live
 * account to confirm which one a real deployment will actually receive:
 *
 *  - `customer.subscription.updated`/`.deleted`: `event.data.object` IS the
 *    Subscription itself, which always carries `.metadata` at its own top
 *    level (set via `subscription_data.metadata` at Checkout-creation time
 *    — see tenant-stripe-provider.ts's `createSubscriptionCheckoutSession`,
 *    and this ADR's own addendum for why that's the chosen mechanism) and
 *    `.id` as its own subscription id — no ambiguity, no fallback needed.
 *  - `invoice.paid`/`invoice.payment_failed`: `event.data.object` is the
 *    Invoice, which does NOT carry the subscription's metadata directly.
 *    Pre-2025-03-31 API versions nest the subscription id at
 *    `object.subscription` and (when expanded, or copied by an integration)
 *    metadata at `object.subscription_details.metadata`; the 2025-03-31
 *    "billing meter"/invoice restructure moved both under
 *    `object.parent.subscription_details`. Both shapes are tried, oldest
 *    first, with no live account available to confirm which this repo's
 *    eventual real deployment will see.
 */
export function extractSubscriptionEventContext(
  eventType: string,
  object: Record<string, unknown>,
): { siteId: string | null; stripeSubscriptionId: string | null } {
  if (eventType === "customer.subscription.updated" || eventType === "customer.subscription.deleted") {
    const metadata = object.metadata as { siteId?: string } | undefined;
    return { siteId: metadata?.siteId ?? null, stripeSubscriptionId: (object.id as string | undefined) ?? null };
  }

  // invoice.paid / invoice.payment_failed
  const legacyDetails = object.subscription_details as { subscription?: string; metadata?: { siteId?: string } } | undefined;
  const parent = object.parent as { subscription_details?: { subscription?: string; metadata?: { siteId?: string } } } | undefined;
  const stripeSubscriptionId =
    (object.subscription as string | undefined) ?? legacyDetails?.subscription ?? parent?.subscription_details?.subscription ?? null;
  const siteId = legacyDetails?.metadata?.siteId ?? parent?.subscription_details?.metadata?.siteId ?? null;
  return { siteId, stripeSubscriptionId };
}
