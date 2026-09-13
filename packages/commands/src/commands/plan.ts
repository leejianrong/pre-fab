import type { Command } from "../registry.js";
import type { Subscription, UpgradePlanResult } from "@prefab/api-client";

export const subscriptionGet: Command<Record<string, never>, Subscription> = {
  name: "subscription.get",
  description: "Get the signed-in account's plan and subscription state (Slice 8, ADR-0012)",
  run: (ctx) => ctx.api.getSubscription(),
};

export const planUpgrade: Command<Record<string, never>, UpgradePlanResult> = {
  name: "plan.upgrade",
  mutation: "plan.upgrade",
  description: "Start (or complete, if already pro) an upgrade to the pro plan — returns a checkout URL when one is needed",
  run: (ctx) => ctx.api.upgradePlan(),
};

/**
 * The `Subscription` shape returned by the API, plus a `message` field
 * narrating the cancellation — additive only, so a `--json` caller reading
 * the fields it already reads (`retentionEndsAt` included) sees no
 * breaking change, and `apps/cli/src/output.ts`'s `printHuman` can surface
 * `message` as the human-mode success line instead of a raw JSON dump.
 */
export type CancelPlanResult = Subscription & { message: string };

/** UTC-pinned so the date in the message is identical regardless of the machine's local timezone (KAN-1268). */
function formatRetentionDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function cancelMessage(subscription: Subscription): string {
  if (!subscription.retentionEndsAt) return "Subscription canceled.";
  const formatted = formatRetentionDate(subscription.retentionEndsAt);
  return `Subscription canceled. Your data and export access are guaranteed until ${formatted} — run \`prefab export\` anytime before then.`;
}

export const planCancel: Command<Record<string, never>, CancelPlanResult> = {
  name: "plan.cancel",
  mutation: "plan.cancel",
  description:
    "Cancel the pro plan — data and export access are guaranteed for a 30-day retention window (R7); the result's message and retentionEndsAt name the exact export deadline",
  run: async (ctx) => {
    const subscription = await ctx.api.cancelPlan();
    return { ...subscription, message: cancelMessage(subscription) };
  },
};
