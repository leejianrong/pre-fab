import { useEffect, useState, type CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { PaymentProps } from "./schema.js";

/**
 * The third interactive block, after Form and Booking (ADR-0007) —
 * `client:load` is applied to this component specifically in
 * @prefab/publish's page-template.ts, the same special-cased branch those
 * two get and for the same reason (a static import Astro's compiler can
 * point a client directive at). Deliberately still SSR-safe: every
 * `window`/`document` reference below lives inside a `useEffect`
 * (tools/checks' ssr-safety scan flags those identifiers unconditionally,
 * not just at render time, so even a click-handler reference outside an
 * effect would fail it) — navigating to Stripe's own Checkout page is done
 * by setting `redirectUrl` state from the click handler and letting a
 * separate effect perform the actual `window.location.assign`.
 */
export interface PaymentExtraProps {
  /** Where the checkout island posts to — injected by the publish pipeline via data.json, absent inside the Puck canvas and in an offline local build (R16), where the block renders its static shell only. */
  runtimeApiUrl?: string;
}

type PaymentState = "idle" | "checking-return" | "paying" | "redirecting" | "success" | "error";

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: cssVar("spacing", "element") };
const headingStyle: CSSProperties = { fontSize: cssVar("fontSize", "lg"), color: cssVar("color", "foreground"), margin: 0 };
const bodyStyle: CSSProperties = { fontSize: cssVar("fontSize", "body"), color: cssVar("color", "foreground") };
const amountStyle: CSSProperties = { fontSize: cssVar("fontSize", "lg"), color: cssVar("color", "foreground"), fontWeight: "bold" };
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

/** `amount` is always cents — Intl.NumberFormat's own `style: "currency"` wants whole currency units, so this is the one division point, done for display only (never for anything sent back to the runtime). */
function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function Payment(props: PaymentProps & PaymentExtraProps & BlockRenderProps) {
  const { heading, description, buttonLabel, amount, currency, successMessage, runtimeApiUrl, blockId, responsive } = props;
  const [state, setState] = useState<PaymentState>(runtimeApiUrl && blockId ? "checking-return" : "idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  // Stripe's own success_url redirect (see apps/api/src/app.ts's runtime
  // checkout route) lands the visitor back on this exact page with a query
  // param naming which payment block to show a thank-you state for —
  // read once on mount, the same "browser API, confined to an effect"
  // discipline Booking.tsx's own timezone detection uses.
  useEffect(() => {
    if (!blockId) {
      setState("idle");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("pf_payment") === "success" && params.get("pf_payment_block") === blockId) {
      setState("success");
    } else {
      setState("idle");
    }
  }, [blockId]);

  useEffect(() => {
    if (!redirectUrl) return;
    window.location.assign(redirectUrl);
  }, [redirectUrl]);

  async function handlePay() {
    if (!runtimeApiUrl || !blockId) return;
    setState("paying");
    setErrorMessage(null);
    try {
      const response = await fetch(`${runtimeApiUrl}/v1/runtime/payment-blocks/${blockId}/checkout`, { method: "POST" });
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
      <div className="pf-block pf-payment" data-pf-block-type="payment" data-pf-block-id={blockId}>
        <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
        <p style={bodyStyle}>{successMessage}</p>
      </div>
    );
  }

  return (
    <div className="pf-block pf-payment" data-pf-block-type="payment" data-pf-block-id={blockId} style={sectionStyle}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      {heading ? <h3 style={headingStyle}>{heading}</h3> : null}
      {description ? <p style={bodyStyle}>{description}</p> : null}
      <p style={amountStyle}>{formatAmount(amount, currency)}</p>
      {!runtimeApiUrl || !blockId ? (
        <p style={bodyStyle}>Payment is available once this page is published.</p>
      ) : (
        <>
          <button type="button" style={buttonStyle} disabled={state === "paying" || state === "redirecting"} onClick={() => void handlePay()}>
            {state === "paying" || state === "redirecting" ? "Redirecting…" : buttonLabel}
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
