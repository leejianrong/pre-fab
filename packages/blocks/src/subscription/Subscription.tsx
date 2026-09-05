import { useEffect, useState, type CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { SubscriptionProps } from "./schema.js";

/**
 * KAN-1154 / ADR-0016: the recurring counterpart to Payment.tsx — same
 * `client:load`-hydrated, SSR-safe shape (every `window`/`document`
 * reference lives inside a `useEffect`, same reasoning Payment.tsx's own
 * comment gives), same publish-pipeline special-casing
 * (@prefab/publish's page-template.ts). The only real differences from
 * Payment.tsx are what's displayed (a per-interval price, plus a trial
 * callout when configured) and which runtime endpoint it posts to
 * (`/v1/runtime/subscription-blocks/:blockId/checkout`, not
 * `/v1/runtime/payment-blocks/:blockId/checkout` — a completely separate
 * block type, per ADR-0016).
 */
export interface SubscriptionExtraProps {
  /** Where the checkout island posts to — injected by the publish pipeline via data.json, absent inside the Puck canvas and in an offline local build (R16), where the block renders its static shell only. */
  runtimeApiUrl?: string;
}

type SubscriptionState = "idle" | "checking-return" | "subscribing" | "redirecting" | "success" | "error";

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: cssVar("spacing", "element") };
const headingStyle: CSSProperties = { fontSize: cssVar("fontSize", "lg"), color: cssVar("color", "foreground"), margin: 0 };
const bodyStyle: CSSProperties = { fontSize: cssVar("fontSize", "body"), color: cssVar("color", "foreground") };
const priceStyle: CSSProperties = { fontSize: cssVar("fontSize", "lg"), color: cssVar("color", "foreground"), fontWeight: "bold" };
const trialStyle: CSSProperties = { fontSize: cssVar("fontSize", "sm"), color: cssVar("color", "foreground") };
const buttonStyle: CSSProperties = {
  padding: `${cssVar("spacing", "xs")} ${cssVar("spacing", "element")}`,
  borderRadius: cssVar("radius", "control"),
  border: "none",
  background: cssVar("color", "accent"),
  color: cssVar("color", "accent-foreground"),
  fontSize: cssVar("fontSize", "body"),
  cursor: "pointer",
  alignSelf: "flex-start",
};
const warningStyle: CSSProperties = {
  fontSize: cssVar("fontSize", "sm"),
  color: cssVar("color", "foreground"),
  border: `1px solid ${cssVar("color", "border")}`,
  borderRadius: cssVar("radius", "control"),
  padding: cssVar("spacing", "xs"),
};

/** `price` is always cents-per-interval — the one division point, display only, mirrors Payment.tsx's formatAmount exactly. */
function formatPrice(price: number, currency: string, interval: "month" | "year"): string {
  const suffix = interval === "month" ? "/month" : "/year";
  try {
    return `${new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(price / 100)}${suffix}`;
  } catch {
    return `${(price / 100).toFixed(2)} ${currency.toUpperCase()}${suffix}`;
  }
}

export function Subscription(props: SubscriptionProps & SubscriptionExtraProps & BlockRenderProps) {
  const { heading, description, buttonLabel, price, currency, interval, trialPeriodDays, successMessage, runtimeApiUrl, blockId, responsive } = props;
  const [state, setState] = useState<SubscriptionState>(runtimeApiUrl && blockId ? "checking-return" : "idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  // Stripe's own success_url redirect (see apps/api/src/app.ts's runtime
  // checkout route) lands the visitor back on this exact page with a query
  // param naming which subscription block to show a thank-you state for —
  // same mechanism Payment.tsx's own return-detection effect uses.
  useEffect(() => {
    if (!blockId) {
      setState("idle");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("pf_subscription") === "success" && params.get("pf_subscription_block") === blockId) {
      setState("success");
    } else {
      setState("idle");
    }
  }, [blockId]);

  useEffect(() => {
    if (!redirectUrl) return;
    window.location.assign(redirectUrl);
  }, [redirectUrl]);

  async function handleSubscribe() {
    if (!runtimeApiUrl || !blockId) return;
    setState("subscribing");
    setErrorMessage(null);
    try {
      const response = await fetch(`${runtimeApiUrl}/v1/runtime/subscription-blocks/${blockId}/checkout`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setErrorMessage(body?.error?.message ?? "Something went wrong — please try again.");
        setState("error");
        return;
      }
      const body = (await response.json()) as { url: string };
      setState("redirecting");
      setRedirectUrl(body.url);
    } catch {
      setErrorMessage("Something went wrong — please try again.");
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <div className="pf-block pf-subscription" data-pf-block-type="subscription" data-pf-block-id={blockId}>
        <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
        <p style={bodyStyle}>{successMessage}</p>
      </div>
    );
  }

  return (
    <div className="pf-block pf-subscription" data-pf-block-type="subscription" data-pf-block-id={blockId} style={sectionStyle}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      {heading ? <h3 style={headingStyle}>{heading}</h3> : null}
      {description ? <p style={bodyStyle}>{description}</p> : null}
      <p style={priceStyle}>{formatPrice(price, currency, interval)}</p>
      {trialPeriodDays > 0 ? <p style={trialStyle}>{trialPeriodDays}-day free trial</p> : null}
      {!runtimeApiUrl || !blockId ? (
        <p style={bodyStyle}>Subscriptions are available once this page is published.</p>
      ) : (
        <>
          <button type="button" style={buttonStyle} disabled={state === "subscribing" || state === "redirecting"} onClick={() => void handleSubscribe()}>
            {state === "subscribing" || state === "redirecting" ? "Redirecting…" : buttonLabel}
          </button>
          {state === "error" && errorMessage ? (
            <p style={warningStyle} role="alert">
              {errorMessage}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
