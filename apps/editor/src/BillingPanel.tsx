import { useEffect, useState } from "react";
import { ApiClientError, type Subscription } from "@prefab/api-client";
import { api } from "./api.js";
import { Card, FilledButton, SideSheet, StatusBadge, TextButton } from "./ui/index.js";

/** UTC-pinned, same reasoning as packages/commands/src/commands/plan.ts's own formatRetentionDate — the date in a message must read identically regardless of the viewer's local timezone. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * Same client-side message packages/commands/src/commands/plan.ts's
 * `cancelMessage` builds for the CLI (KAN-1268) — duplicated rather than
 * imported because apps/editor never depends on @prefab/commands (that
 * package wraps @prefab/api-client for the CLI/MCP surfaces, not the
 * browser), and the API's own POST /v1/account/plan/cancel returns a plain
 * Subscription with no `message` field of its own — the narration is a
 * presentation-layer concern both the CLI and this panel independently add
 * on top of the same `retentionEndsAt`.
 */
function cancelMessage(subscription: Subscription): string {
  if (!subscription.retentionEndsAt) return "Subscription canceled.";
  return `Subscription canceled. Your data and export access are guaranteed until ${formatDate(subscription.retentionEndsAt)} — you can export anytime before then.`;
}

/** True once an account counts as actually on the pro plan for gating purposes — mirrors apps/api/src/lib/subscriptions.ts's own canAddCustomDomain exactly (pro plan, not canceled). */
function isActivePro(subscription: Subscription): boolean {
  return subscription.plan === "pro" && subscription.status !== "canceled";
}

/**
 * KAN-1267: the editor had zero billing/plan UI anywhere — a free-plan
 * owner hitting the custom-domain gate (apps/api's `plan_required` error)
 * had no path forward except the CLI's own `prefab plan upgrade`. This is
 * the toolbar-button-opens-a-panel counterpart to that CLI command plus
 * `subscription.get`/`plan.cancel` (packages/commands/src/commands/plan.ts,
 * ADR-0012), account-scoped rather than site-scoped like every other panel
 * — a signed-in account's plan covers every site it owns, so this panel
 * takes no `siteId` prop at all.
 *
 * Same "toolbar button opens a SideSheet" convention as PagesPanel/
 * DomainsPanel/PaymentsPanel. DomainsPanel's own `plan_required` gate error
 * (KAN-1267) doesn't embed this panel inline — it just asks SiteEditor to
 * close Domains and open this one via an `onOpenBilling` callback, so
 * there's never two nested SideSheets open at once.
 *
 * Upgrading calls `api.upgradePlan()` and, exactly like a real Stripe
 * integration would, hands the owner the checkout URL it returns to
 * complete on Stripe's own hosted page — this dev environment's
 * FakeStripeProvider (apps/api/src/lib/stripe.ts) returns a URL that
 * doesn't resolve to anything real, and completing it here relies on the
 * same dev-only `/v1/dev/stripe/:accountId/advance` route e2e/tests/
 * billing.spec.ts drives directly; there is no in-editor "simulate
 * checkout" button because nothing else in this codebase gives dev-only
 * webhook simulation a product-facing affordance either (the tenant-Stripe
 * connect flow in PaymentsPanel is the one exception, and only because
 * connecting itself — not completing a checkout — is the whole flow there).
 */
export function BillingPanel({ onClose }: { onClose: () => void }) {
  const [subscription, setSubscription] = useState<Subscription | null | undefined>(undefined);
  const [upgrading, setUpgrading] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setSubscription(await api.getSubscription());
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function upgrade() {
    setUpgrading(true);
    setError(null);
    setCancelNotice(null);
    try {
      const result = await api.upgradePlan();
      setSubscription(result.subscription);
      setCheckoutUrl(result.checkout?.url ?? null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setUpgrading(false);
    }
  }

  async function cancel() {
    setCanceling(true);
    setError(null);
    try {
      const canceled = await api.cancelPlan();
      setSubscription(canceled);
      setCheckoutUrl(null);
      setCancelNotice(cancelMessage(canceled));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCanceling(false);
    }
  }

  return (
    <SideSheet title="Billing" ariaLabel="Billing" closeLabel="Close billing panel" onClose={onClose} width={440}>
      {error ? <p className="pf-error-text">{error}</p> : null}
      {cancelNotice ? (
        <Card variant="filled" style={{ display: "grid", gap: "0.35rem" }}>
          <strong>Plan canceled</strong>
          <p className="pf-supporting-text" style={{ margin: 0 }}>
            {cancelNotice}
          </p>
        </Card>
      ) : null}

      {subscription === undefined ? (
        <p className="pf-supporting-text">Loading…</p>
      ) : subscription === null ? null : (
        <Card variant="filled" style={{ display: "grid", gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <strong style={{ flex: 1 }}>{isActivePro(subscription) ? "Pro plan" : "Free plan"}</strong>
            <StatusBadge tone={isActivePro(subscription) ? "positive" : "neutral"}>
              {subscription.status === "past_due" ? "payment past due" : subscription.status}
            </StatusBadge>
          </div>

          {subscription.status === "past_due" && subscription.gracePeriodEndsAt ? (
            <p className="pf-supporting-text" style={{ margin: 0 }}>
              A recent payment failed. Your Pro features keep working until {formatDate(subscription.gracePeriodEndsAt)} while Stripe
              retries the charge.
            </p>
          ) : null}

          {isActivePro(subscription) ? (
            <>
              <p className="pf-supporting-text" style={{ margin: 0 }}>
                Custom domains and everything else on the pro plan are unlocked.
              </p>
              <TextButton
                className="pf-destructive-button"
                onClick={cancel}
                disabled={canceling}
                style={{ justifySelf: "start" }}
              >
                {canceling ? "Canceling…" : "Cancel plan"}
              </TextButton>
            </>
          ) : (
            <>
              {subscription.plan === "pro" && subscription.status === "canceled" && subscription.retentionEndsAt ? (
                <p className="pf-supporting-text" style={{ margin: 0 }}>
                  Canceled — data and export access stay available until {formatDate(subscription.retentionEndsAt)}.
                </p>
              ) : (
                <p className="pf-supporting-text" style={{ margin: 0 }}>
                  Upgrade to pro to add custom domains and unlock everything else pro plan sites get.
                </p>
              )}
              {checkoutUrl ? (
                <Card style={{ padding: "0.6rem", display: "grid", gap: "0.35rem" }}>
                  <p className="pf-supporting-text" style={{ margin: 0 }}>
                    Complete your upgrade on Stripe's checkout page, then come back here.
                  </p>
                  <a href={checkoutUrl} target="_blank" rel="noreferrer" style={{ justifySelf: "start" }}>
                    Continue to Stripe checkout ↗
                  </a>
                </Card>
              ) : (
                <FilledButton onClick={upgrade} disabled={upgrading} style={{ justifySelf: "start" }}>
                  {upgrading ? "Starting upgrade…" : "Upgrade to Pro"}
                </FilledButton>
              )}
            </>
          )}
        </Card>
      )}
    </SideSheet>
  );
}
