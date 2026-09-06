import { useEffect, useState } from "react";
import type { CartCheckoutRecord, OrderItem } from "@prefab/api-client";
import { api } from "./api.js";
import { Card, FilledButton, OutlinedButton, SideSheet, StatusBadge, TextField } from "./ui/index.js";

/** `price`/`unitAmount` are always cents — same division-point-for-display-only rule the blocks package's own formatPrice helpers use. */
function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function downloadFile(filename: string, contents: string, contentType: string) {
  const blob = new Blob([contents], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * KAN-1246 / ADR-0018 (part 3 addendum): the owner-facing order-management
 * panel — list + detail + "mark shipped" action + CSV export. An "order" is
 * a `cart_checkout_records` row once its status moves to 'completed' (see
 * that ADR addendum's point 1); this panel is the closest structural
 * template to ProductsPanel.tsx (list + form), adapted for a header/detail
 * view with one status-changing action rather than a full document editor —
 * order.list/order.get/order.markShipped already do the real work here,
 * this is deliberately not a second place that duplicates their validation.
 */
export function OrdersPanel({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const [orders, setOrders] = useState<CartCheckoutRecord[] | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const result = await api.listOrders(siteId, { limit: 100 });
    setOrders(result.records);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportCsv() {
    downloadFile(`${siteId}-orders.csv`, await api.exportOrdersCsv(siteId), "text/csv");
  }

  return (
    <SideSheet
      title={selectedOrderId ? "Order" : "Orders"}
      ariaLabel="Orders"
      closeLabel="Close orders panel"
      onClose={onClose}
      width={480}
    >
      {error ? <p className="pf-error-text">{error}</p> : null}
      {selectedOrderId ? (
        <OrderDetail
          siteId={siteId}
          orderId={selectedOrderId}
          onBack={() => setSelectedOrderId(null)}
          onChanged={() => refresh().catch(() => {})}
        />
      ) : orders === null ? (
        <p className="pf-supporting-text">Loading…</p>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <OutlinedButton onClick={exportCsv}>Export CSV</OutlinedButton>
          </div>
          {orders.length === 0 ? (
            <p className="pf-supporting-text">No orders yet — an order appears here once a visitor's cart checkout completes.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
              {orders.map((order) => (
                <li key={order.id}>
                  <Card
                    interactive
                    onClick={() => setSelectedOrderId(order.id)}
                    style={{ padding: "0.6rem", display: "flex", alignItems: "center", gap: "0.5rem" }}
                  >
                    <span className="pf-supporting-text" style={{ flex: 1 }}>
                      {new Date(order.createdAt).toLocaleString()}
                    </span>
                    <span>{formatAmount(order.amountSubtotal, order.currency)}</span>
                    <StatusBadge tone={order.status === "completed" ? "positive" : order.status === "failed" ? "negative" : "neutral"}>
                      {order.status}
                    </StatusBadge>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </SideSheet>
  );
}

function OrderDetail({
  siteId,
  orderId,
  onBack,
  onChanged,
}: {
  siteId: string;
  orderId: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [order, setOrder] = useState<CartCheckoutRecord | null>(null);
  const [items, setItems] = useState<OrderItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackingDrafts, setTrackingDrafts] = useState<Record<string, string>>({});
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  async function refresh() {
    const result = await api.getOrder(siteId, orderId);
    setOrder(result.order);
    setItems(result.items);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [siteId, orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ship(item: OrderItem) {
    const trackingNumber = (trackingDrafts[item.id] ?? "").trim();
    if (trackingNumber === "") return;
    setBusyItemId(item.id);
    setError(null);
    try {
      await api.markOrderItemShipped(siteId, item.id, { trackingNumber });
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyItemId(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <OutlinedButton onClick={onBack} style={{ justifySelf: "start" }}>
        ← All orders
      </OutlinedButton>
      {error ? <p className="pf-error-text">{error}</p> : null}
      {order === null || items === null ? (
        <p className="pf-supporting-text">Loading…</p>
      ) : (
        <>
          <Card style={{ padding: "0.6rem", display: "grid", gap: "0.3rem" }}>
            <span className="pf-supporting-text">{new Date(order.createdAt).toLocaleString()}</span>
            <span>{order.buyerEmail ?? "no email on file"}</span>
            <span>
              Subtotal {formatAmount(order.amountSubtotal, order.currency)}
              {order.requiresShipping ? " + shipping" : ""}
            </span>
            <StatusBadge tone={order.status === "completed" ? "positive" : order.status === "failed" ? "negative" : "neutral"}>
              {order.status}
            </StatusBadge>
          </Card>

          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
            {items.map((item) => (
              <li key={item.id}>
                <Card style={{ padding: "0.6rem", display: "grid", gap: "0.4rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <strong style={{ flex: 1 }}>{item.title}</strong>
                    <span className="pf-supporting-text">
                      {item.quantity} × {formatAmount(item.unitAmount, item.currency)}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <StatusBadge tone={item.status === "delivered" ? "positive" : item.status === "shipped" ? "neutral" : "neutral"}>
                      {item.status}
                    </StatusBadge>
                    <span className="pf-supporting-text">{item.fulfillmentType === "physical" ? "Physical" : "Digital / service"}</span>
                    {item.oversold ? (
                      <span className="pf-error-text" title="Stock ran out before this order was created — resolve manually (refund or contact the customer).">
                        oversold
                      </span>
                    ) : null}
                  </div>
                  {item.trackingNumber ? (
                    <span className="pf-supporting-text">Tracking: {item.trackingNumber}</span>
                  ) : item.status === "unfulfilled" ? (
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <TextField
                        label="Tracking number"
                        value={trackingDrafts[item.id] ?? ""}
                        onChange={(v) => setTrackingDrafts({ ...trackingDrafts, [item.id]: v })}
                      />
                      <FilledButton type="button" disabled={busyItemId === item.id} onClick={() => void ship(item)}>
                        {busyItemId === item.id ? "Saving…" : "Mark shipped"}
                      </FilledButton>
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
