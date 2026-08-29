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

export const planCancel: Command<Record<string, never>, Subscription> = {
  name: "plan.cancel",
  mutation: "plan.cancel",
  description: "Cancel the pro plan — data and export keep working for a 30-day retention window (R7)",
  run: (ctx) => ctx.api.cancelPlan(),
};
