import { describe, expect, it } from "vitest";
import {
  addDays,
  canAddCustomDomain,
  isRetentionExpired,
  applyCheckoutCompleted,
  applyPaymentFailed,
  applyPaymentSucceeded,
  applyCanceled,
  GRACE_PERIOD_DAYS,
  RETENTION_DAYS,
} from "../src/lib/subscriptions.js";

describe("canAddCustomDomain — Slice 8's first plan gate (ADR-0012)", () => {
  it("blocks the free plan", () => {
    expect(canAddCustomDomain({ plan: "free", status: "active" })).toBe(false);
  });

  it("allows an active pro plan", () => {
    expect(canAddCustomDomain({ plan: "pro", status: "active" })).toBe(true);
  });

  it("allows a pro plan in a payment-failure grace period — never an immediate takedown", () => {
    expect(canAddCustomDomain({ plan: "pro", status: "past_due" })).toBe(true);
  });

  it("blocks a canceled pro plan, even though it was once pro", () => {
    expect(canAddCustomDomain({ plan: "pro", status: "canceled" })).toBe(false);
  });

  it("blocks a canceled free plan (the only plan free can be)", () => {
    expect(canAddCustomDomain({ plan: "free", status: "canceled" })).toBe(false);
  });
});

describe("addDays — UTC-millisecond arithmetic across timezones (retention-window date arithmetic)", () => {
  it("adds exactly N × 24h in milliseconds, not a calendar-day increment", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = addDays(start, 30);
    expect(end.getTime() - start.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("is unaffected by a US DST spring-forward transition (2026-03-08, America/New_York) inside the window", () => {
    // A calendar-day-based implementation using a local-timezone Date
    // field mutation (e.g. setDate) would drift by an hour across this
    // boundary; millisecond arithmetic must not.
    const start = new Date("2026-03-01T12:00:00.000Z");
    const end = addDays(start, 30);
    expect(end.toISOString()).toBe("2026-03-31T12:00:00.000Z");
  });

  it("is unaffected by a US DST fall-back transition (2026-11-01, America/New_York) inside the window", () => {
    const start = new Date("2026-10-15T12:00:00.000Z");
    const end = addDays(start, 30);
    expect(end.toISOString()).toBe("2026-11-14T12:00:00.000Z");
  });

  it("gives every timezone the same elapsed real time regardless of local calendar effects", () => {
    const start = new Date("2026-06-15T23:30:00.000Z");
    const end = addDays(start, RETENTION_DAYS);
    expect(end.getTime() - start.getTime()).toBe(RETENTION_DAYS * 24 * 60 * 60 * 1000);
  });
});

describe("isRetentionExpired — R7's one condition allowed to stop serving a site", () => {
  it("is false for an active subscription", () => {
    expect(isRetentionExpired({ status: "active", retentionEndsAt: null })).toBe(false);
  });

  it("is false for a canceled subscription still inside its retention window", () => {
    const now = new Date("2026-01-15T00:00:00.000Z");
    const retentionEndsAt = addDays(now, 1);
    expect(isRetentionExpired({ status: "canceled", retentionEndsAt }, now)).toBe(false);
  });

  it("is true once the retention window has fully elapsed", () => {
    const retentionEndsAt = new Date("2026-01-15T00:00:00.000Z");
    const now = addDays(retentionEndsAt, 1);
    expect(isRetentionExpired({ status: "canceled", retentionEndsAt }, now)).toBe(true);
  });

  it("is true at the exact boundary instant", () => {
    const retentionEndsAt = new Date("2026-01-15T00:00:00.000Z");
    expect(isRetentionExpired({ status: "canceled", retentionEndsAt }, retentionEndsAt)).toBe(true);
  });

  it("is false for a past_due (grace period) subscription, even with a retentionEndsAt somehow set", () => {
    const retentionEndsAt = new Date("2020-01-01T00:00:00.000Z");
    expect(isRetentionExpired({ status: "past_due", retentionEndsAt }, new Date())).toBe(false);
  });
});

describe("subscription lifecycle transitions — pure (accountId, patch) shape, no I/O", () => {
  it("applyCheckoutCompleted moves to pro/active and clears any prior grace/cancellation state", () => {
    const patch = applyCheckoutCompleted({ stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" });
    expect(patch).toEqual({
      plan: "pro",
      status: "active",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      gracePeriodEndsAt: null,
      canceledAt: null,
      retentionEndsAt: null,
    });
  });

  it("applyPaymentFailed moves to past_due with a grace period, never straight to canceled", () => {
    const now = new Date("2026-02-01T00:00:00.000Z");
    const patch = applyPaymentFailed(now);
    expect(patch.status).toBe("past_due");
    expect(patch.gracePeriodEndsAt).toEqual(addDays(now, GRACE_PERIOD_DAYS));
  });

  it("applyPaymentSucceeded clears the grace period and reactivates", () => {
    expect(applyPaymentSucceeded()).toEqual({ status: "active", gracePeriodEndsAt: null });
  });

  it("applyCanceled starts the 30-day retention window from the cancellation instant", () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    const patch = applyCanceled(now);
    expect(patch.status).toBe("canceled");
    expect(patch.canceledAt).toEqual(now);
    expect(patch.retentionEndsAt).toEqual(addDays(now, RETENTION_DAYS));
  });
});
