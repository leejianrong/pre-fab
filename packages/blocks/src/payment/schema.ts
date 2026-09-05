import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

/**
 * KAN-1137 / ADR-0005: a one-off payment via the SITE OWNER's own Stripe
 * account (bring-your-own, never the platform's). `amount`/`currency` are
 * the price a visitor pays — snapshotted into @prefab/db's `payment_blocks`
 * at publish time (packages/publish's payment-manifest.ts) and always
 * resolved from that snapshot server-side, never accepted from the
 * visitor's own checkout request, so a tampered request can never pay a
 * different amount than what's configured here.
 */
export const PaymentPropsSchema = z
  .object({
    heading: z.string().min(1).max(120),
    description: z.string().max(500).default(""),
    buttonLabel: z.string().min(1).max(40).default("Pay now"),
    /** Cents — e.g. 1000 for $10.00. Whole-currency-unit math (dollars, euros) never appears in a block's own props, the same reasoning Stripe's own API uses `unit_amount` for. */
    amount: z.number().int().positive().max(99_999_999),
    /** Lowercase ISO 4217, e.g. "usd", "eur", "gbp". */
    currency: z
      .string()
      .regex(/^[a-z]{3}$/, "must be a lowercase 3-letter ISO 4217 currency code")
      .default("usd"),
    successMessage: z.string().max(300).default("Thank you — your payment was received."),
  })
  .strict();

export type PaymentProps = z.infer<typeof PaymentPropsSchema>;

export const PAYMENT_BLOCK_TYPE = "payment";
export const PAYMENT_BLOCK_VERSION = 1;

export const paymentDefaultProps: PaymentProps = {
  heading: "Buy now",
  description: "",
  buttonLabel: "Pay now",
  amount: 1000,
  currency: "usd",
  successMessage: "Thank you — your payment was received.",
};

export const paymentBlockDefinition: BlockTypeDefinition<PaymentProps> = {
  type: PAYMENT_BLOCK_TYPE,
  version: PAYMENT_BLOCK_VERSION,
  propsSchema: PaymentPropsSchema,
  defaultProps: paymentDefaultProps,
  migrations: {},
};
