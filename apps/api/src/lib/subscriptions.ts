import type { Plan, SubscriptionStatus } from "@prefab/db";

/**
 * The pure, algorithmic heart of Slice 8 — plan gate evaluation and
 * retention-window arithmetic, both named directly in SLICES.md's own Unit
 * test list. Kept free of any Stripe or Postgres dependency so both are
 * testable with no I/O at all, the same discipline @prefab/schema's diff
 * engine and migration functions already follow.
 */

export const GRACE_PERIOD_DAYS = 7;
export const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * UTC-millisecond arithmetic, deliberately never calendar-day (`Date`
 * field) arithmetic: "30 days" must mean exactly 30 × 24h everywhere, so a
 * subscription canceled right before a DST transition (in the account's
 * timezone, the server's timezone, or any other) still gets exactly the
 * same retention window as one canceled any other day. Calendar-day
 * addition in a local zone is the bug this guards against — it would
 * silently grant 29 or 31 days across a spring-forward or fall-back
 * boundary.
 */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export interface SubscriptionGateState {
  plan: Plan;
  status: SubscriptionStatus;
}

/**
 * The first plan gate in the codebase (SLICES.md Slice 8) — custom domains
 * are blocked on the free plan. A grace-period `past_due` account keeps
 * full access ("a grace state, not immediate takedown"); only an actually
 * `canceled` subscription loses it. Free forever regardless of plan/status:
 * export (R7) — this function is never consulted on that path at all.
 */
export function canAddCustomDomain(subscription: SubscriptionGateState): boolean {
  return subscription.plan === "pro" && subscription.status !== "canceled";
}

export interface RetentionState {
  status: SubscriptionStatus;
  retentionEndsAt: Date | null;
}

/** True once a canceled account's 30-day retention window has fully elapsed — the one condition allowed to stop serving a site (never export, R7). */
export function isRetentionExpired(subscription: RetentionState, now: Date = new Date()): boolean {
  return subscription.status === "canceled" && subscription.retentionEndsAt !== null && now.getTime() >= subscription.retentionEndsAt.getTime();
}

// ---- Subscription lifecycle transitions ----
// Each function is a pure `(subscription) -> patch` — apps/api's webhook
// handler and its dev-only simulation endpoint both call the exact same
// functions, so a Stripe-dashboard-initiated cancellation and one this
// platform's own `plan.cancel` mutation triggers converge on identical
// state, never two slightly different code paths.

export interface SubscriptionPatchInput {
  plan?: Plan;
  status?: SubscriptionStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  gracePeriodEndsAt?: Date | null;
  canceledAt?: Date | null;
  retentionEndsAt?: Date | null;
}

export function applyCheckoutCompleted(input: { stripeCustomerId: string; stripeSubscriptionId: string }): SubscriptionPatchInput {
  return {
    plan: "pro",
    status: "active",
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    gracePeriodEndsAt: null,
    canceledAt: null,
    retentionEndsAt: null,
  };
}

/** Dunning: a failed payment moves the account to a grace state, never an immediate takedown (SLICES.md). */
export function applyPaymentFailed(now: Date = new Date()): SubscriptionPatchInput {
  return { status: "past_due", gracePeriodEndsAt: addDays(now, GRACE_PERIOD_DAYS) };
}

/** Reactivation: a subsequent successful payment (retried card, updated payment method) clears the grace state. */
export function applyPaymentSucceeded(): SubscriptionPatchInput {
  return { status: "active", gracePeriodEndsAt: null };
}

/** Cancellation, whichever side initiated it: starts the 30-day retention window (R7 — export, and serving, both keep working inside it). */
export function applyCanceled(now: Date = new Date()): SubscriptionPatchInput {
  return { status: "canceled", canceledAt: now, retentionEndsAt: addDays(now, RETENTION_DAYS) };
}
