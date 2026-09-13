import { describe, expect, it } from "vitest";
import type { Subscription } from "@prefab/api-client";
import type { CommandContext } from "../src/context.js";
import { planCancel } from "../src/commands/plan.js";

/**
 * KAN-1268: cancelling never gets a blocking confirmation prompt (that
 * would hang or misbehave for --json/agent callers under R12/R13 —
 * ADR-0001 makes agents first-class peers with humans on every command).
 * The fix is a clearer *output* message. These are pure unit tests — no
 * DB, no HTTP — of `planCancel.run`'s formatting logic; the underlying
 * `retentionEndsAt` arithmetic itself is covered separately by
 * apps/api/src/lib/subscriptions.ts's own tests.
 */

function fakeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_1",
    accountId: "acct_1",
    plan: "free",
    status: "canceled",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: null,
    gracePeriodEndsAt: null,
    canceledAt: "2026-09-13T00:00:00.000Z",
    retentionEndsAt: "2026-10-13T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    ...overrides,
  };
}

function contextReturning(subscription: Subscription): CommandContext {
  return { api: { cancelPlan: async () => subscription } } as unknown as CommandContext;
}

describe("plan.cancel — KAN-1268: narrate the export/retention window", () => {
  it("adds a human-readable `message` naming the exact retentionEndsAt date, additive to every Subscription field", async () => {
    const subscription = fakeSubscription();
    const result = await planCancel.run(contextReturning(subscription), {});

    // Additive only: a --json caller reading today's fields (retentionEndsAt
    // included) still gets exactly them, unchanged — this must never become
    // a breaking shape change.
    expect(result).toMatchObject(subscription);
    expect(result.message).toBe(
      "Subscription canceled. Your data and export access are guaranteed until October 13, 2026 — run `prefab export` anytime before then.",
    );
  });

  it("falls back to a plain message when retentionEndsAt is null", async () => {
    const subscription = fakeSubscription({ retentionEndsAt: null });
    const result = await planCancel.run(contextReturning(subscription), {});
    expect(result.message).toBe("Subscription canceled.");
  });

  it("formats the date from the UTC calendar day, not the host machine's local timezone", async () => {
    // 00:30 UTC on Jan 1st is still Dec 31st in any timezone west of UTC —
    // pins that the formatter reads the UTC date, never a local one, so
    // the message is identical no matter where the CLI runs.
    const subscription = fakeSubscription({ retentionEndsAt: "2026-01-01T00:30:00.000Z" });
    const result = await planCancel.run(contextReturning(subscription), {});
    expect(result.message).toContain("January 1, 2026");
  });
});
