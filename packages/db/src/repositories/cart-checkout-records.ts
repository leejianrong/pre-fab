import type { PoolClient } from "pg";
import type { FulfillmentType } from "@prefab/schema";

export type CartCheckoutRecordStatus = "pending" | "completed" | "failed";

/** One resolved, server-validated line of a completed cart Checkout session — see createCartCheckout (@prefab/runtime) for where this is built, always from the CURRENT `products` row, never the visitor's own cart. */
export interface CartCheckoutRecordItem {
  productId: string;
  quantity: number;
  /** Cents. */
  unitAmount: number;
  currency: string;
  title: string;
  fulfillmentType: FulfillmentType;
}

/**
 * KAN-1245 / ADR-0018 cart addendum: a sibling to PaymentRecord/
 * SubscriptionRecord, not a branch on either — see
 * 0014_kan1245_cart_checkout.sql's own header comment for why a cart
 * checkout has no `blockId` to key off of at all. Visitor PII/payment
 * metadata (R20), platform Postgres only, never in a site source tree —
 * mirrors payment-records.ts's own shape.
 */
export interface CartCheckoutRecord {
  id: string;
  siteId: string;
  stripeSessionId: string;
  items: CartCheckoutRecordItem[];
  currency: string;
  /** Cents — sum of every line's unitAmount * quantity, excluding shipping. */
  amountSubtotal: number;
  requiresShipping: boolean;
  status: CartCheckoutRecordStatus;
  buyerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawCartCheckoutRecordRow {
  id: string;
  site_id: string;
  stripe_session_id: string;
  items: CartCheckoutRecordItem[];
  currency: string;
  amount_subtotal: number;
  requires_shipping: boolean;
  status: CartCheckoutRecordStatus;
  buyer_email: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToCartCheckoutRecord(row: RawCartCheckoutRecordRow): CartCheckoutRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    stripeSessionId: row.stripe_session_id,
    items: row.items,
    currency: row.currency,
    amountSubtotal: row.amount_subtotal,
    requiresShipping: row.requires_shipping,
    status: row.status,
    buyerEmail: row.buyer_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateCartCheckoutRecordInput {
  id: string;
  siteId: string;
  stripeSessionId: string;
  items: CartCheckoutRecordItem[];
  currency: string;
  amountSubtotal: number;
  requiresShipping: boolean;
}

/**
 * The one write the runtime cart-checkout endpoint makes once Stripe hands
 * back a Checkout session — created 'pending', mirrors
 * createPaymentRecord/createSubscriptionRecord's own "session might still be
 * abandoned" reasoning. There is deliberately no
 * `updateCartCheckoutRecordStatus` in this file yet — see this migration's
 * own header comment and the ADR addendum's "Note for card 3": that's
 * KAN-1246's webhook consumer's job, which does not exist yet.
 */
export async function createCartCheckoutRecord(client: PoolClient, input: CreateCartCheckoutRecordInput): Promise<CartCheckoutRecord> {
  const result = await client.query<RawCartCheckoutRecordRow>(
    `INSERT INTO cart_checkout_records (id, site_id, stripe_session_id, items, currency, amount_subtotal, requires_shipping)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      input.id,
      input.siteId,
      input.stripeSessionId,
      JSON.stringify(input.items),
      input.currency,
      input.amountSubtotal,
      input.requiresShipping,
    ],
  );
  return rowToCartCheckoutRecord(result.rows[0]!);
}

/** By its own row id — the runtime checkout endpoint's own `id` (also the Checkout Session's own `client_reference_id`/`metadata.cartCheckoutRecordId`), same shape as getSubscriptionRecordById. Useful to callers (tests, a future owner-facing single-record read) that already hold it. */
export async function getCartCheckoutRecordById(client: PoolClient, siteId: string, id: string): Promise<CartCheckoutRecord | null> {
  const result = await client.query<RawCartCheckoutRecordRow>(`SELECT * FROM cart_checkout_records WHERE site_id = $1 AND id = $2`, [
    siteId,
    id,
  ]);
  return result.rows[0] ? rowToCartCheckoutRecord(result.rows[0]) : null;
}
