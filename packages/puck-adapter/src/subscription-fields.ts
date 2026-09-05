import type { Fields } from "@puckeditor/core";
import type { SubscriptionProps } from "@prefab/blocks";

/** Hand-mapped from SubscriptionPropsSchema to Puck's inspector field types — same convention as payment-fields.ts. `price` is entered and stored as cents PER INTERVAL (Stripe's own unit), never dollars/euros — the field label says so rather than silently converting underneath the owner. */
export const subscriptionFields: Fields<SubscriptionProps> = {
  heading: { type: "text", label: "Heading" },
  description: { type: "textarea", label: "Description" },
  buttonLabel: { type: "text", label: "Button label" },
  price: { type: "number", label: "Price per interval (in cents, e.g. 2500 = $25.00)", min: 1 },
  currency: { type: "text", label: "Currency (lowercase 3-letter code, e.g. usd)" },
  interval: {
    type: "select",
    label: "Billing interval",
    options: [
      { label: "Monthly", value: "month" },
      { label: "Yearly", value: "year" },
    ],
  },
  trialPeriodDays: { type: "number", label: "Free trial (days, 0 = no trial)", min: 0 },
  successMessage: { type: "textarea", label: "Message shown after successfully subscribing" },
};
