import type { PoolClient } from "pg";
import type { FulfillmentType } from "@prefab/schema";

export type OrderItemStatus = "unfulfilled" | "shipped" | "delivered";

/**
 * KAN-1246 / ADR-0018 (part 3 addendum): one row per cart line's fulfillment
 * state — NOT a new "orders" header table, see 0015_kan1246_orders.sql's
 * own header comment for why `cart_checkout_records` already is the order
 * header once its `status` moves to 'completed'. Visitor-purchase-adjacent
 * (R20), platform Postgres only, never in a site source tree — same posture
 * as every other table this row is FK'd to or mirrors.
 */
export interface OrderItem {
  id: string;
  cartCheckoutRecordId: string;
  siteId: string;
  productId: string;
  quantity: number;
  /** Cents — snapshotted at order-creation time, never re-read from the live `products` row afterward. */
  unitAmount: number;
  currency: string;
  title: string;
  fulfillmentType: FulfillmentType;
  status: OrderItemStatus;
  trackingNumber: string | null;
  /** See decrementProductStock's own comment (products.ts) — set when this line's stock decrement found insufficient stock. Always false for a digital/service line. */
  oversold: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface RawOrderItemRow {
  id: string;
  cart_checkout_record_id: string;
  site_id: string;
  product_id: string;
  quantity: number;
  unit_amount: number;
  currency: string;
  title: string;
  fulfillment_type: FulfillmentType;
  status: OrderItemStatus;
  tracking_number: string | null;
  oversold: boolean;
  created_at: Date;
  updated_at: Date;
}

function rowToOrderItem(row: RawOrderItemRow): OrderItem {
  return {
    id: row.id,
    cartCheckoutRecordId: row.cart_checkout_record_id,
    siteId: row.site_id,
    productId: row.product_id,
    quantity: row.quantity,
    unitAmount: row.unit_amount,
    currency: row.currency,
    title: row.title,
    fulfillmentType: row.fulfillment_type,
    status: row.status,
    trackingNumber: row.tracking_number,
    oversold: row.oversold,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateOrderItemInput {
  id: string;
  cartCheckoutRecordId: string;
  siteId: string;
  productId: string;
  quantity: number;
  unitAmount: number;
  currency: string;
  title: string;
  fulfillmentType: FulfillmentType;
  /** 'unfulfilled' for a physical line, 'delivered' for a digital/service line (auto-delivered on payment) — the caller (cart-order-webhook.ts) decides which, this function just persists it. */
  status: OrderItemStatus;
  oversold?: boolean;
}

/**
 * The one write apps/api's cart-order-webhook.ts makes per cart line, once
 * per completed cart checkout — called from inside the same transaction
 * that transitions cart_checkout_records.status to 'completed' and (for a
 * physical line) decrements stock, so a redelivered webhook can never
 * double-create this row (guarded one level up, by
 * markCartCheckoutRecordCompleted's own `fromStatuses`-style guard — see
 * that function's comment).
 */
export async function createOrderItem(client: PoolClient, input: CreateOrderItemInput): Promise<OrderItem> {
  const result = await client.query<RawOrderItemRow>(
    `INSERT INTO order_items (id, cart_checkout_record_id, site_id, product_id, quantity, unit_amount, currency, title, fulfillment_type, status, oversold)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      input.id,
      input.cartCheckoutRecordId,
      input.siteId,
      input.productId,
      input.quantity,
      input.unitAmount,
      input.currency,
      input.title,
      input.fulfillmentType,
      input.status,
      input.oversold ?? false,
    ],
  );
  return rowToOrderItem(result.rows[0]!);
}

/** Every line belonging to one order (cart_checkout_records row) — the owner-facing order-detail read. */
export async function listOrderItemsForCartCheckoutRecord(client: PoolClient, siteId: string, cartCheckoutRecordId: string): Promise<OrderItem[]> {
  const result = await client.query<RawOrderItemRow>(
    `SELECT * FROM order_items WHERE site_id = $1 AND cart_checkout_record_id = $2 ORDER BY created_at ASC, id ASC`,
    [siteId, cartCheckoutRecordId],
  );
  return result.rows.map(rowToOrderItem);
}

/**
 * The owner-facing `order.markShipped` mutation's own write — guarded to
 * only ever fire from 'unfulfilled' (a digital/service line is already
 * 'delivered' at creation and has no shipping step; an already-'shipped'
 * line re-shipping is very likely a stale double-click, not a second real
 * shipment). No row matched -> `null`, same "no side effect on a mismatched
 * precondition" discipline `updateSubscriptionLifecycle`'s own
 * `fromStatuses` guard documents — the caller (apps/api/src/app.ts) turns
 * that into a 404.
 */
export async function markOrderItemShipped(
  client: PoolClient,
  siteId: string,
  orderItemId: string,
  trackingNumber: string,
): Promise<OrderItem | null> {
  const result = await client.query<RawOrderItemRow>(
    `UPDATE order_items SET status = 'shipped', tracking_number = $1, updated_at = now()
     WHERE site_id = $2 AND id = $3 AND status = 'unfulfilled'
     RETURNING *`,
    [trackingNumber, siteId, orderItemId],
  );
  return result.rows[0] ? rowToOrderItem(result.rows[0]) : null;
}

/** One order_item, by its own row id — used to resolve which order it belongs to before applying an owner action (mirrors getSubmission/getEventSignup's "look up before act" shape). */
export async function getOrderItem(client: PoolClient, siteId: string, orderItemId: string): Promise<OrderItem | null> {
  const result = await client.query<RawOrderItemRow>(`SELECT * FROM order_items WHERE site_id = $1 AND id = $2`, [siteId, orderItemId]);
  return result.rows[0] ? rowToOrderItem(result.rows[0]) : null;
}

export interface OrderItemExportRow extends OrderItem {
  /** From the order's own cart_checkout_records row — the CSV export's one join, so the owner doesn't have to cross-reference two files. */
  buyerEmail: string | null;
  orderCreatedAt: Date;
}

/** Every order_item on a site, unpaginated, joined against its own order header for buyerEmail/orderCreatedAt — mirrors listAllSubmissionsForExport/listAllEventSignupsForExport exactly (KAN-1246's own CSV export). */
export async function listAllOrderItemsForExport(client: PoolClient, siteId: string): Promise<OrderItemExportRow[]> {
  const result = await client.query<RawOrderItemRow & { buyer_email: string | null; order_created_at: Date }>(
    `SELECT oi.*, ccr.buyer_email, ccr.created_at AS order_created_at
     FROM order_items oi
     JOIN cart_checkout_records ccr ON ccr.id = oi.cart_checkout_record_id
     WHERE oi.site_id = $1
     ORDER BY oi.created_at DESC, oi.id DESC`,
    [siteId],
  );
  return result.rows.map((row) => ({
    ...rowToOrderItem(row),
    buyerEmail: row.buyer_email,
    orderCreatedAt: row.order_created_at,
  }));
}
