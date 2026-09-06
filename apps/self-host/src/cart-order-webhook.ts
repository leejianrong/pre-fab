import { newUlid } from "@prefab/schema";
import type { SelfHostDb } from "./db.js";
import { recordStripeWebhookEvent } from "./subscription-webhook.js";

/**
 * KAN-1247 / ADR-0018 (part 4 addendum): a self-contained SQLite mirror of
 * apps/api/src/lib/cart-order-webhook.ts (deliberately duplicated, not
 * imported — apps/self-host cannot depend on @prefab/db; ADR-0010/CLAUDE.md
 * invariant 4). Same two-layer idempotency discipline as the Postgres
 * original (see that file's own module comment for the full reasoning):
 *
 *  1. **Exact redelivery**: `recordStripeWebhookEvent` (imported from
 *     subscription-webhook.ts, not duplicated a second time) against this
 *     instance's own `stripe_webhook_events` table — the same
 *     event-type-agnostic dedup table every webhook consumer here shares.
 *  2. **Out-of-order/duplicate delivery**: `markCartCheckoutRecordCompleted`'s
 *     own `AND status = 'pending'` guard — a redelivery matches no row,
 *     returns `null`, and `applyCartCheckoutCompleted`'s own `if (record)`
 *     guard skips order_items creation and the stock decrement a second
 *     time.
 *
 * Atomicity: no explicit `db.transaction()` wrapper. Every write below is a
 * single synchronous better-sqlite3 statement with no `await` between the
 * status transition and the last order_items insert — the same reasoning
 * event-signup-adapters.ts's own comment already gives for why this
 * runtime needs no concurrency guard at all (a single Node process can
 * never interleave two requests mid-sequence of synchronous statements
 * with no intervening `await`). See this card's own ADR addendum for the
 * one respect this is weaker than the Postgres original (no automatic
 * rollback on a thrown error partway through).
 */

export interface CartCheckoutRecordItemRow {
  productId: string;
  quantity: number;
  unitAmount: number;
  currency: string;
  title: string;
  fulfillmentType: "physical" | "digital_or_service";
}

export type CartCheckoutRecordStatus = "pending" | "completed" | "failed";

export interface CartCheckoutRecordRow {
  id: string;
  siteId: string;
  stripeSessionId: string;
  items: CartCheckoutRecordItemRow[];
  currency: string;
  amountSubtotal: number;
  requiresShipping: boolean;
  status: CartCheckoutRecordStatus;
  buyerEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawCartCheckoutRecordRow {
  id: string;
  site_id: string;
  stripe_session_id: string;
  items: string;
  currency: string;
  amount_subtotal: number;
  requires_shipping: number;
  status: CartCheckoutRecordStatus;
  buyer_email: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: RawCartCheckoutRecordRow): CartCheckoutRecordRow {
  return {
    id: row.id,
    siteId: row.site_id,
    stripeSessionId: row.stripe_session_id,
    items: JSON.parse(row.items),
    currency: row.currency,
    amountSubtotal: row.amount_subtotal,
    requiresShipping: row.requires_shipping === 1,
    status: row.status,
    buyerEmail: row.buyer_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Mirrors packages/db/src/repositories/cart-checkout-records.ts's own markCartCheckoutRecordCompleted exactly — keyed by `stripe_session_id` (Stripe's own Checkout Session id), not this row's own internal id, for the same reason that function's comment gives. */
export function markCartCheckoutRecordCompleted(db: SelfHostDb, stripeSessionId: string, patch: { buyerEmail: string | null }): CartCheckoutRecordRow | null {
  const result = db
    .prepare(
      `UPDATE cart_checkout_records SET
         status = 'completed',
         buyer_email = COALESCE(@buyerEmail, buyer_email),
         updated_at = @updatedAt
       WHERE stripe_session_id = @stripeSessionId AND status = 'pending'`,
    )
    .run({ buyerEmail: patch.buyerEmail, updatedAt: new Date().toISOString(), stripeSessionId });
  if (result.changes === 0) return null;
  const row = db.prepare<[string], RawCartCheckoutRecordRow>("SELECT * FROM cart_checkout_records WHERE stripe_session_id = ?").get(stripeSessionId);
  return row ? rowToRecord(row) : null;
}

export function getCartCheckoutRecordById(db: SelfHostDb, siteId: string, id: string): CartCheckoutRecordRow | null {
  const row = db.prepare<[string, string], RawCartCheckoutRecordRow>("SELECT * FROM cart_checkout_records WHERE site_id = ? AND id = ?").get(siteId, id);
  return row ? rowToRecord(row) : null;
}

export interface OrderItemRow {
  id: string;
  cartCheckoutRecordId: string;
  siteId: string;
  productId: string;
  quantity: number;
  unitAmount: number;
  currency: string;
  title: string;
  fulfillmentType: "physical" | "digital_or_service";
  status: "unfulfilled" | "shipped" | "delivered";
  oversold: boolean;
}

/** Mirrors packages/db/src/repositories/products.ts's own decrementProductStock exactly — a strict conditional UPDATE first (no race, the common case), floored at zero with SQLite's `MAX()` (Postgres' `GREATEST()`) when that matches zero rows. Call only for a `fulfillmentType === "physical"` line. */
export function decrementProductStock(db: SelfHostDb, productId: string, quantity: number): { oversold: boolean } {
  const strict = db.prepare("UPDATE products SET stock_count = stock_count - @quantity WHERE id = @productId AND stock_count >= @quantity").run({ productId, quantity });
  if (strict.changes > 0) return { oversold: false };

  const floored = db.prepare("UPDATE products SET stock_count = MAX(stock_count - @quantity, 0) WHERE id = @productId").run({ productId, quantity });
  if (floored.changes === 0) throw new Error(`product ${productId} not found while decrementing stock`);
  return { oversold: true };
}

/** Mirrors packages/db/src/repositories/order-items.ts's own createOrderItem exactly. */
export function createOrderItem(db: SelfHostDb, input: OrderItemRow): OrderItemRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO order_items (id, cart_checkout_record_id, site_id, product_id, quantity, unit_amount, currency, title, fulfillment_type, status, oversold, created_at, updated_at)
     VALUES (@id, @cartCheckoutRecordId, @siteId, @productId, @quantity, @unitAmount, @currency, @title, @fulfillmentType, @status, @oversold, @createdAt, @updatedAt)`,
  ).run({
    id: input.id,
    cartCheckoutRecordId: input.cartCheckoutRecordId,
    siteId: input.siteId,
    productId: input.productId,
    quantity: input.quantity,
    unitAmount: input.unitAmount,
    currency: input.currency,
    title: input.title,
    fulfillmentType: input.fulfillmentType,
    status: input.status,
    oversold: input.oversold ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });
  return input;
}

export type CartOrderWebhookOutcome =
  | { status: "applied"; cartCheckoutRecord: CartCheckoutRecordRow; orderItems: OrderItemRow[] }
  | { status: "deduped" }
  | { status: "no_match" };

/**
 * Mirrors apps/api/src/lib/cart-order-webhook.ts's own applyCartCheckoutCompleted
 * function-for-function — see this module's own comment for the full
 * idempotency/atomicity reasoning.
 */
export async function applyCartCheckoutCompleted(
  eventId: string,
  input: { siteId: string; stripeSessionId: string; buyerEmail: string | null },
  db: SelfHostDb,
): Promise<CartOrderWebhookOutcome> {
  if (!recordStripeWebhookEvent(db, eventId, "checkout.session.completed")) return { status: "deduped" };

  const record = markCartCheckoutRecordCompleted(db, input.stripeSessionId, { buyerEmail: input.buyerEmail });
  if (!record) return { status: "no_match" };

  const orderItems: OrderItemRow[] = [];
  for (const line of record.items) {
    if (line.fulfillmentType === "physical") {
      const decrement = decrementProductStock(db, line.productId, line.quantity);
      orderItems.push(
        createOrderItem(db, {
          id: newUlid(),
          cartCheckoutRecordId: record.id,
          siteId: input.siteId,
          productId: line.productId,
          quantity: line.quantity,
          unitAmount: line.unitAmount,
          currency: line.currency,
          title: line.title,
          fulfillmentType: line.fulfillmentType,
          status: "unfulfilled",
          oversold: decrement.oversold,
        }),
      );
    } else {
      orderItems.push(
        createOrderItem(db, {
          id: newUlid(),
          cartCheckoutRecordId: record.id,
          siteId: input.siteId,
          productId: line.productId,
          quantity: line.quantity,
          unitAmount: line.unitAmount,
          currency: line.currency,
          title: line.title,
          fulfillmentType: line.fulfillmentType,
          status: "delivered",
          oversold: false,
        }),
      );
    }
  }

  return { status: "applied", cartCheckoutRecord: record, orderItems };
}
