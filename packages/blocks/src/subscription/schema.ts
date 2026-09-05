import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

/**
 * KAN-1154 / ADR-0016: the recurring counterpart to the one-off Payment
 * block (KAN-1137 / ADR-0005), same bring-your-own-Stripe model, deliberately
 * a DISTINCT block type rather than a new mode on `payment` — see ADR-0016's
 * question 1 for the full reasoning (a per-interval `price` is not the same
 * thing as a one-time `amount`, and folding the two into one schema would
 * mean conditional validation on every reader of `payment` props). Every
 * field below is server-resolved from this block's own publish-time
 * snapshot (`subscription_blocks`) and never accepted from a visitor's own
 * checkout request — the same discipline `payment/schema.ts`'s own comment
 * documents for `amount`.
 */
export const SubscriptionPropsSchema = z
  .object({
    heading: z.string().min(1).max(120),
    description: z.string().max(500).default(""),
    buttonLabel: z.string().min(1).max(40).default("Subscribe"),
    /** Cents, PER INTERVAL — e.g. 2500 with interval "month" means $25.00/month. Never called "amount": that name means "a one-time total" everywhere else in this codebase (the `payment` block's own field), and this isn't one. */
    price: z.number().int().positive().max(99_999_999),
    /** Lowercase ISO 4217, e.g. "usd", "eur", "gbp". */
    currency: z
      .string()
      .regex(/^[a-z]{3}$/, "must be a lowercase 3-letter ISO 4217 currency code")
      .default("usd"),
    /** Stripe Checkout's own `price_data[recurring][interval]` values — no "week"/"day" here because Stripe's Billing UI and this block's own copy ("Subscribe — $25/month") both assume month/year framing; narrower on purpose, not a Stripe limitation. */
    interval: z.enum(["month", "year"]).default("month"),
    /** Days of free trial before the first invoice — 0 means no trial. Passed to Stripe as `subscription_data[trial_period_days]` at checkout-session-creation time (this is a one-time checkout-session setting, not a later lifecycle transition — see ADR-0016). */
    trialPeriodDays: z.number().int().min(0).max(365).default(0),
    successMessage: z.string().max(300).default("Thank you — your subscription is active."),
  })
  .strict();

export type SubscriptionProps = z.infer<typeof SubscriptionPropsSchema>;

export const SUBSCRIPTION_BLOCK_TYPE = "subscription";
export const SUBSCRIPTION_BLOCK_VERSION = 1;

export const subscriptionDefaultProps: SubscriptionProps = {
  heading: "Subscribe",
  description: "",
  buttonLabel: "Subscribe",
  price: 2500,
  currency: "usd",
  interval: "month",
  trialPeriodDays: 0,
  successMessage: "Thank you — your subscription is active.",
};

export const subscriptionBlockDefinition: BlockTypeDefinition<SubscriptionProps> = {
  type: SUBSCRIPTION_BLOCK_TYPE,
  version: SUBSCRIPTION_BLOCK_VERSION,
  propsSchema: SubscriptionPropsSchema,
  defaultProps: subscriptionDefaultProps,
  migrations: {},
};
