import type { Fields } from "@puckeditor/core";
import type { PaymentProps } from "@prefab/blocks";

/** Hand-mapped from PaymentPropsSchema to Puck's inspector field types — same convention as hero-fields.ts/form-fields.ts. `amount` is entered and stored as cents (Stripe's own unit), never dollars/euros — the field label says so rather than silently converting underneath the owner. */
export const paymentFields: Fields<PaymentProps> = {
  heading: { type: "text", label: "Heading" },
  description: { type: "textarea", label: "Description" },
  buttonLabel: { type: "text", label: "Button label" },
  amount: { type: "number", label: "Amount (in cents, e.g. 1000 = $10.00)", min: 1 },
  currency: { type: "text", label: "Currency (lowercase 3-letter code, e.g. usd)" },
  successMessage: { type: "textarea", label: "Message shown after a successful payment" },
};
