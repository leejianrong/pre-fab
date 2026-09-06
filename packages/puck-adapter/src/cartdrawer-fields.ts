import type { Fields } from "@puckeditor/core";
import type { CartDrawerProps } from "@prefab/blocks";

/** Hand-mapped from CartDrawerPropsSchema to Puck's inspector field types — same convention as payment-fields.ts/subscription-fields.ts. */
export const cartDrawerFields: Fields<CartDrawerProps> = {
  heading: { type: "text", label: "Heading" },
  emptyMessage: { type: "textarea", label: "Message shown when the cart is empty" },
  checkoutButtonLabel: { type: "text", label: "Checkout button label" },
};
