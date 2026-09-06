import type { Pool } from "pg";
import {
  withTenantContext,
  recordStripeWebhookEvent,
  markCartCheckoutRecordCompleted,
  decrementProductStock,
  createOrderItem,
  type CartCheckoutRecord,
  type OrderItem,
} from "@prefab/db";
import { newUlid } from "@prefab/schema";

/**
 * KAN-1246 / ADR-0018 (part 3 addendum): `checkout.session.completed` for a
 * cart-mode Checkout session — the webhook consumer 0014_kan1245_cart_
 * checkout.sql's own header comment named as this card's job. Shares the
 * exact two-layer idempotency shape apps/api/src/lib/subscription-webhook.ts
 * already documents (see that file's own module comment for the full
 * reasoning):
 *
 *  1. **Exact redelivery**: `recordStripeWebhookEvent` against the same
 *     global `stripe_webhook_events` table subscriptions/payments already
 *     share (Stripe event ids are globally unique regardless of which
 *     integration receives them).
 *  2. **Out-of-order / duplicate-but-different-event-id delivery**:
 *     `markCartCheckoutRecordCompleted`'s own `AND status = 'pending'`
 *     guard — a redelivery arriving after this has already run once matches
 *     no row, returns `null`, and this module's `if (record)` guard skips
 *     both order_items creation and stock decrement a second time.
 *
 * New to this card (the subscription/payment webhooks have no equivalent):
 * order_items creation and stock decrement happen INSIDE the same
 * `withTenantContext` transaction as the status transition itself (one
 * `client`, one COMMIT or none) — so a redelivered webhook can never
 * transition the header to 'completed' while only partially creating its
 * line items, and never decrement stock twice for the same order.
 */
export type CartOrderWebhookOutcome =
  | { status: "applied"; cartCheckoutRecord: CartCheckoutRecord; orderItems: OrderItem[] }
  | { status: "deduped" }
  | { status: "no_match" };

interface Deps {
  pool: Pool;
}

export async function applyCartCheckoutCompleted(
  eventId: string,
  input: { siteId: string; stripeSessionId: string; buyerEmail: string | null },
  deps: Deps,
): Promise<CartOrderWebhookOutcome> {
  const isNewEvent = await withTenantContext(deps.pool, {}, (client) => recordStripeWebhookEvent(client, eventId, "checkout.session.completed"));
  if (!isNewEvent) return { status: "deduped" };

  const result = await withTenantContext(deps.pool, { siteId: input.siteId }, async (client) => {
    const record = await markCartCheckoutRecordCompleted(client, input.siteId, input.stripeSessionId, { buyerEmail: input.buyerEmail });
    if (!record) return null;

    const orderItems: OrderItem[] = [];
    for (const line of record.items) {
      if (line.fulfillmentType === "physical") {
        // Atomic, oversell-safe (products.ts's own decrementProductStock) —
        // the money is already collected by the time this runs, so an
        // insufficient-stock outcome never blocks this order_item's own
        // creation, only flags it `oversold` for the owner to resolve by
        // hand (see that function's own comment for the full reasoning).
        const decrement = await decrementProductStock(client, line.productId, line.quantity);
        orderItems.push(
          await createOrderItem(client, {
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
        // Digital/service: nothing to ship, nothing to run out of — the
        // card's own "auto-delivered on payment". The visitor sees this
        // product's own successMessage via the runtime receipt endpoint
        // (apps/api/src/app.ts's cart-checkout receipt route).
        orderItems.push(
          await createOrderItem(client, {
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
    return { record, orderItems };
  });

  if (!result) return { status: "no_match" };
  return { status: "applied", cartCheckoutRecord: result.record, orderItems: result.orderItems };
}
