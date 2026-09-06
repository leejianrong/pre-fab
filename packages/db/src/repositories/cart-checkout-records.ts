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

/**
 * KAN-1246 / ADR-0018 (part 3 addendum): the transition this migration's own
 * header comment named as "KAN-1246's job" — `checkout.session.completed`
 * for a cart-mode session. Keyed by `stripe_session_id`
 * (`cart_checkout_records_stripe_session_id_idx`), not this row's own `id` —
 * that index's own migration comment names exactly this lookup ("looks a
 * session up by id alone, with no siteId in hand yet — same reasoning as
 * payment_records_stripe_session_id_idx"), and the real webhook's own
 * `object.id` (Stripe's own Checkout Session id) is what a real event
 * always carries, mirroring `updatePaymentRecordStatus`'s identical
 * `stripe_session_id` lookup for the one-off path one branch above it in
 * app.ts. `AND status = 'pending'` is the identical idempotency guard
 * `updatePaymentRecordStatus`/`completeSubscriptionCheckout` already
 * document: a redelivered webhook (same or different Stripe event id) that
 * arrives after this has already run once matches no row, returns `null`,
 * and the caller's `if (updated)` guard skips both order_items creation and
 * stock decrement a second time. Called from inside the SAME
 * `withTenantContext` transaction that then creates this record's
 * order_items and decrements stock (apps/api/src/lib/cart-order-webhook.ts)
 * — one commit or none, never a status flip with no line items to match it.
 */
export async function markCartCheckoutRecordCompleted(
  client: PoolClient,
  siteId: string,
  stripeSessionId: string,
  patch: { buyerEmail: string | null },
): Promise<CartCheckoutRecord | null> {
  const result = await client.query<RawCartCheckoutRecordRow>(
    `UPDATE cart_checkout_records SET
       status = 'completed',
       buyer_email = COALESCE($1, buyer_email),
       updated_at = now()
     WHERE site_id = $2 AND stripe_session_id = $3 AND status = 'pending'
     RETURNING *`,
    [patch.buyerEmail, siteId, stripeSessionId],
  );
  return result.rows[0] ? rowToCartCheckoutRecord(result.rows[0]) : null;
}

export interface ListCartCheckoutRecordsOptions {
  /** Clamped to [1, 200]. Default 50. */
  limit?: number;
  /** Clamped to >= 0. Default 0. */
  offset?: number;
  status?: CartCheckoutRecordStatus;
}

export interface ListCartCheckoutRecordsResult {
  records: CartCheckoutRecord[];
  total: number;
}

const CART_CHECKOUT_DEFAULT_LIMIT = 50;
const CART_CHECKOUT_MAX_LIMIT = 200;

/** The owner-facing order list/dashboard read (KAN-1246) — mirrors listPaymentRecordsForSite/listSubscriptionRecordsForSite exactly, but scoped by siteId alone (a cart checkout has no blockId to further scope by — see this table's own migration header comment). */
export async function listCartCheckoutRecordsForSite(
  client: PoolClient,
  siteId: string,
  options: ListCartCheckoutRecordsOptions = {},
): Promise<ListCartCheckoutRecordsResult> {
  const limit = Math.min(CART_CHECKOUT_MAX_LIMIT, Math.max(1, Math.trunc(options.limit ?? CART_CHECKOUT_DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));

  const whereParts = ["site_id = $1"];
  const params: unknown[] = [siteId];
  if (options.status) {
    params.push(options.status);
    whereParts.push(`status = $${params.length}`);
  }
  const where = whereParts.join(" AND ");

  const countResult = await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM cart_checkout_records WHERE ${where}`, params);
  const rowsResult = await client.query<RawCartCheckoutRecordRow>(
    `SELECT * FROM cart_checkout_records WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return { records: rowsResult.rows.map(rowToCartCheckoutRecord), total: Number(countResult.rows[0]!.count) };
}
