import type { Command } from "../registry.js";
import type {
  ListOrdersQuery,
  ListOrdersResult,
  MarkOrderItemShippedInput,
  OrderItem,
  OrderWithItems,
} from "@prefab/api-client";

/**
 * KAN-1246 / ADR-0018 (part 3 addendum): orders, inventory and fulfillment.
 * An "order" is a `cart_checkout_records` row once its status moves to
 * 'completed' — see that ADR addendum's point 1 for why there is no
 * separate "orders" collection distinct from what KAN-1245 already built.
 * order.list/order.get/order.export are non-mutating reads (same reason
 * product.list/product.get/submission.export carry no `mutation` field
 * either); order.markShipped is the one owner-driven fulfillment
 * transition this card wires a mutation for.
 */
export const orderList: Command<{ siteId: string } & ListOrdersQuery, ListOrdersResult> = {
  name: "order.list",
  description: "List a site's orders (completed/pending/failed cart checkouts), paginated",
  run: (ctx, args) => {
    const { siteId, ...query } = args;
    return ctx.api.listOrders(siteId, query);
  },
};

export const orderGet: Command<{ siteId: string; orderId: string }, OrderWithItems> = {
  name: "order.get",
  description: "Get one order's header plus its own line items (fulfillment status, tracking number, oversold flag)",
  run: (ctx, args) => ctx.api.getOrder(args.siteId, args.orderId),
};

export const orderExport: Command<{ siteId: string; format?: "csv" | "json" }, string> = {
  name: "order.export",
  description: "Export a site's orders as CSV or JSON (default CSV) — one row per order_item",
  run: async (ctx, args) => {
    if (args.format === "json") return JSON.stringify(await ctx.api.exportOrdersJson(args.siteId), null, 2);
    return ctx.api.exportOrdersCsv(args.siteId);
  },
};

export const orderMarkShipped: Command<{ siteId: string; orderItemId: string } & MarkOrderItemShippedInput, OrderItem> = {
  name: "order.markShipped",
  mutation: "order.markShipped",
  description: "Mark a physical order_item 'shipped' with a free-text tracking number (unfulfilled -> shipped only)",
  run: (ctx, args) => {
    const { siteId, orderItemId, ...input } = args;
    return ctx.api.markOrderItemShipped(siteId, orderItemId, input);
  },
};
