import { useEffect, useState } from "react";
import { PAYMENT_BLOCK_TYPE, SUBSCRIPTION_BLOCK_TYPE } from "@prefab/blocks";
import {
  ApiClientError,
  type PageSummary,
  type PaymentRecord,
  type StripeConnectionStatus,
  type SubscriptionRecord,
} from "@prefab/api-client";
import { api } from "./api.js";
import { Card, FilledButton, OutlinedButton, SideSheet, StatusBadge, TextButton, TextField } from "./ui/index.js";

/** `amount`/`price` are always cents — same division-point-for-display-only rule OrdersPanel's own formatAmount uses. */
function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

type BlockKind = "payment" | "subscription";

interface PaymentBlockRef {
  kind: BlockKind;
  pageId: string;
  pageTitle: string;
  blockId: string;
  /** The block's own `heading` prop — falls back to the block id if a hand-crafted block somehow omits it. */
  heading: string;
}

const PAYMENT_STATUS_TONE: Record<PaymentRecord["status"], "positive" | "neutral" | "negative"> = {
  completed: "positive",
  pending: "neutral",
  failed: "negative",
};

const SUBSCRIPTION_STATUS_TONE: Record<SubscriptionRecord["status"], "positive" | "neutral" | "negative"> = {
  active: "positive",
  trialing: "positive",
  incomplete: "neutral",
  incomplete_expired: "negative",
  past_due: "negative",
  canceled: "negative",
  unpaid: "negative",
  paused: "neutral",
};

/**
 * KAN-1265: BYO-Stripe connect/disconnect plus a read-only view of every
 * payment/subscription block's own checkout/lifecycle history — the editor
 * UI counterpart to Slice 10 / KAN-1137 (ADR-0005) and KAN-1154 (ADR-0016),
 * both of which shipped full backend support (connect/disconnect/status,
 * payment.list, subscription.list — all three-surface-parity per ADR-0003)
 * with no editor affordance to reach any of it.
 *
 * There is no "list every payment/subscription block on this site" endpoint
 * — payment.list/subscription.list are both scoped to one blockId — so this
 * panel derives the block list itself by walking every page's own document
 * (`api.getPage`) and keeping the payment/subscription-typed blocks it
 * finds. SubmissionsPanel scans blocks the same way for Form blocks, but
 * only across the single page already open in the canvas (it's handed that
 * page's document directly); a Payment/Subscription block can live on any
 * page, so this panel fetches every page's document itself rather than
 * being limited to whichever one is currently open. `pages` is the same
 * PageSummary[] SiteEditor already fetches (see its own `pages` state) —
 * passed down rather than refetched, same reasoning PagesPanel's props
 * already establish.
 *
 * Same "toolbar button opens a SideSheet" shape as every other panel, and
 * the same list+detail structure OrdersPanel uses: this panel's own list of
 * blocks stands in for OrdersPanel's list of orders, and selecting one
 * drills into its records exactly like selecting an order drills into its
 * items.
 */
export function PaymentsPanel({ siteId, pages, onClose }: { siteId: string; pages: PageSummary[]; onClose: () => void }) {
  const [status, setStatus] = useState<StripeConnectionStatus | null | undefined>(undefined);
  const [authorizationCode, setAuthorizationCode] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [blocks, setBlocks] = useState<PaymentBlockRef[] | null>(null);
  const [selected, setSelected] = useState<PaymentBlockRef | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshStatus() {
    setStatus(await api.getStripeStatus(siteId));
  }

  async function refreshBlocks() {
    const found: PaymentBlockRef[] = [];
    for (const p of pages) {
      const doc = await api.getPage(siteId, p.id);
      for (const block of doc.blocks) {
        if (block.type !== PAYMENT_BLOCK_TYPE && block.type !== SUBSCRIPTION_BLOCK_TYPE) continue;
        const heading = typeof block.props.heading === "string" ? block.props.heading : block.id;
        found.push({
          kind: block.type === PAYMENT_BLOCK_TYPE ? "payment" : "subscription",
          pageId: p.id,
          pageTitle: p.title,
          blockId: block.id,
          heading,
        });
      }
    }
    setBlocks(found);
  }

  useEffect(() => {
    Promise.all([refreshStatus(), refreshBlocks()]).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  async function submitConnect(event: React.FormEvent) {
    event.preventDefault();
    setConnecting(true);
    setError(null);
    try {
      await api.connectStripe(siteId, { authorizationCode });
      setAuthorizationCode("");
      await refreshStatus();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      await api.disconnectStripe(siteId);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <SideSheet
      title={selected ? selected.heading : "Payments"}
      ariaLabel="Payments"
      closeLabel="Close payments panel"
      onClose={onClose}
      width={480}
    >
      {error ? <p className="pf-error-text">{error}</p> : null}
      {selected ? (
        <BlockRecords siteId={siteId} block={selected} onBack={() => setSelected(null)} />
      ) : (
        <>
          <Card variant="filled" style={{ display: "grid", gap: "0.5rem" }}>
            <strong>Stripe account</strong>
            {status === undefined ? (
              <p className="pf-supporting-text" style={{ margin: 0 }}>
                Loading…
              </p>
            ) : status ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <StatusBadge tone={status.status === "connected" ? "positive" : "negative"}>{status.status}</StatusBadge>
                  <span className="pf-supporting-text" style={{ margin: 0, wordBreak: "break-all" }}>
                    {status.stripeAccountId}
                  </span>
                </div>
                <p className="pf-supporting-text" style={{ margin: 0 }}>
                  Payment and subscription blocks on this site sell through this Stripe account. Pre-fab never takes a cut
                  (bring-your-own Stripe).
                </p>
                <TextButton className="pf-destructive-button" onClick={disconnect} disabled={disconnecting} style={{ justifySelf: "start" }}>
                  {disconnecting ? "Disconnecting…" : "Disconnect Stripe"}
                </TextButton>
              </>
            ) : (
              <>
                <p className="pf-supporting-text" style={{ margin: 0 }}>
                  Connect your own Stripe account to accept payments and subscriptions through the Payment/Subscription blocks.
                </p>
                <form onSubmit={submitConnect} style={{ display: "grid", gap: "0.5rem" }}>
                  <TextField
                    label="Stripe authorization code"
                    value={authorizationCode}
                    onChange={setAuthorizationCode}
                    placeholder="Paste the code from Stripe's Connect consent screen"
                    supportingText="In this dev environment the fake Stripe provider accepts any value here."
                  />
                  <FilledButton type="submit" disabled={connecting || authorizationCode.trim() === ""} style={{ justifySelf: "start" }}>
                    {connecting ? "Connecting…" : "Connect Stripe"}
                  </FilledButton>
                </form>
              </>
            )}
          </Card>

          <h3 className="pf-subsection-title">Payment &amp; subscription blocks</h3>
          {blocks === null ? (
            <p className="pf-supporting-text">Loading…</p>
          ) : blocks.length === 0 ? (
            <p className="pf-supporting-text">
              No payment or subscription blocks on this site yet — add one from the block drawer to start selling.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
              {blocks.map((block) => (
                <li key={block.blockId}>
                  <Card
                    interactive
                    onClick={() => setSelected(block)}
                    style={{ padding: "0.6rem", display: "flex", alignItems: "center", gap: "0.5rem" }}
                  >
                    <div style={{ flex: 1, display: "grid", gap: "0.1rem" }}>
                      <strong>{block.heading}</strong>
                      <span className="pf-supporting-text" style={{ margin: 0 }}>
                        {block.pageTitle}
                      </span>
                    </div>
                    <StatusBadge tone="neutral">{block.kind === "payment" ? "One-off" : "Subscription"}</StatusBadge>
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

function BlockRecords({ siteId, block, onBack }: { siteId: string; block: PaymentBlockRef; onBack: () => void }) {
  const [payments, setPayments] = useState<PaymentRecord[] | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (block.kind === "payment"
      ? api.listPayments(siteId, block.blockId, { limit: 100 }).then((result) => setPayments(result.records))
      : api.listSubscriptions(siteId, block.blockId, { limit: 100 }).then((result) => setSubscriptions(result.records))
    ).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [siteId, block]);

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <OutlinedButton onClick={onBack} style={{ justifySelf: "start" }}>
        ← All blocks
      </OutlinedButton>
      {error ? <p className="pf-error-text">{error}</p> : null}
      {block.kind === "payment" ? (
        payments === null ? (
          <p className="pf-supporting-text">Loading…</p>
        ) : payments.length === 0 ? (
          <p className="pf-supporting-text">No payments yet — a record appears here once a visitor completes checkout.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
            {payments.map((record) => (
              <li key={record.id}>
                <Card style={{ padding: "0.6rem", display: "grid", gap: "0.3rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span className="pf-supporting-text" style={{ flex: 1 }}>
                      {new Date(record.createdAt).toLocaleString()}
                    </span>
                    <span>{formatAmount(record.amount, record.currency)}</span>
                    <StatusBadge tone={PAYMENT_STATUS_TONE[record.status]}>{record.status}</StatusBadge>
                  </div>
                  <span className="pf-supporting-text">{record.buyerEmail ?? "no email on file"}</span>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : subscriptions === null ? (
        <p className="pf-supporting-text">Loading…</p>
      ) : subscriptions.length === 0 ? (
        <p className="pf-supporting-text">No subscriptions yet — a record appears here once a visitor completes checkout.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
          {subscriptions.map((record) => (
            <li key={record.id}>
              <Card style={{ padding: "0.6rem", display: "grid", gap: "0.3rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span className="pf-supporting-text" style={{ flex: 1 }}>
                    {new Date(record.createdAt).toLocaleString()}
                  </span>
                  <span>
                    {formatAmount(record.price, record.currency)}/{record.interval}
                  </span>
                  <StatusBadge tone={SUBSCRIPTION_STATUS_TONE[record.status]}>{record.status}</StatusBadge>
                </div>
                <span className="pf-supporting-text">{record.buyerEmail ?? "no email on file"}</span>
                {record.cancelAtPeriodEnd && record.currentPeriodEnd ? (
                  <span className="pf-supporting-text">Cancels at period end ({new Date(record.currentPeriodEnd).toLocaleDateString()})</span>
                ) : record.currentPeriodEnd ? (
                  <span className="pf-supporting-text">Renews {new Date(record.currentPeriodEnd).toLocaleDateString()}</span>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
