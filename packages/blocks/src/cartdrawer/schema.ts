import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

/**
 * KAN-1245 / ADR-0018 cart addendum: the mini-cart/checkout block —
 * placed by the owner on whichever page(s) they want a cart affordance
 * (typically every page, via a template's Nav/Footer area, the same way an
 * owner places any other block). Reads cart state from localStorage
 * (@prefab/blocks' shared `useCart` hook) — nothing here is server data, so
 * there is nothing to inject at publish/build time the way postlist/
 * productgrid get their collection data.
 */
export const CartDrawerPropsSchema = z
  .object({
    heading: z.string().min(1).max(80).default("Your cart"),
    emptyMessage: z.string().max(200).default("Your cart is empty."),
    checkoutButtonLabel: z.string().min(1).max(40).default("Checkout"),
  })
  .strict();

export type CartDrawerProps = z.infer<typeof CartDrawerPropsSchema>;

export const CARTDRAWER_BLOCK_TYPE = "cartdrawer";
export const CARTDRAWER_BLOCK_VERSION = 1;

export const cartDrawerDefaultProps: CartDrawerProps = {
  heading: "Your cart",
  emptyMessage: "Your cart is empty.",
  checkoutButtonLabel: "Checkout",
};

export const cartDrawerBlockDefinition: BlockTypeDefinition<CartDrawerProps> = {
  type: CARTDRAWER_BLOCK_TYPE,
  version: CARTDRAWER_BLOCK_VERSION,
  propsSchema: CartDrawerPropsSchema,
  defaultProps: cartDrawerDefaultProps,
  migrations: {},
};
