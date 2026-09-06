import { useEffect, useState, type CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import { useCart, type CartItem } from "../cart/useCart.js";
import type { CartDrawerProps } from "./schema.js";

/**
 * KAN-1245 / ADR-0018 cart addendum — the same "special-cased, statically
 * imported so Astro's client:load directive can point at it" treatment
 * Payment/Subscription/Form/Booking/EventSignup already get
 * (@prefab/publish's page-template.ts). Deliberately still SSR-safe: every
 * `window` reference below lives inside a `useEffect` (tools/checks' own
 * ssr-safety scan flags a browser global reference anywhere outside one) —
 * navigating to Stripe's own Checkout page is done by setting `redirectUrl`
 * state from the click handler and letting a separate effect perform the
 * actual `window.location.assign`, exactly Payment.tsx's own pattern.
 */
export interface CartDrawerExtraProps {
  /** Where the checkout island posts to — injected by the publish pipeline via data.json, absent inside the Puck canvas and in an offline local build (R16), where the block renders its static shell only. */
  runtimeApiUrl?: string;
  /** Injected alongside runtimeApiUrl — the cart-checkout route is keyed by siteId, not a single block id (a cart has no one block). */
  siteId?: string;
}

type CheckoutState = "idle" | "submitting" | "redirecting" | "error";

/** `price` is always cents — same division-point-for-display-only rule as Payment.tsx's formatAmount. */
function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(price / 100);
  } catch {
    return `${(price / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function lineTotal(item: CartItem): number {
  return item.price * item.quantity;
}

export function CartDrawer(props: CartDrawerProps & BlockRenderProps & CartDrawerExtraProps) {
  const { heading, emptyMessage, checkoutButtonLabel, runtimeApiUrl, siteId, blockId, responsive } = props;
  const cart = useCart();

  const [open, setOpen] = useState(false);
  const [checkoutState, setCheckoutState] = useState<CheckoutState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);

  // Stripe's own success_url/cancel_url redirect (see apps/api/src/app.ts's
  // runtime cart-checkout route) lands the visitor back on this exact page
  // with `pf_cart=success|cancel` — read once on mount, the same
  // "browser API, confined to an effect" discipline Payment.tsx's own
  // return-detection effect uses. A completed checkout clears the cart —
  // otherwise the just-purchased items would sit in the visitor's cart
  // forever, inviting a duplicate order.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("pf_cart");
    if (outcome === "success") {
      cart.clear();
      setJustCompleted(true);
      setOpen(false);
    }
    // cart.clear is stable (useCallback with no deps) — safe to omit from
    // the dependency list without an exhaustive-deps violation in spirit,
    // but included anyway for clarity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!redirectUrl) return;
    window.location.assign(redirectUrl);
  }, [redirectUrl]);

  async function handleCheckout() {
    if (!runtimeApiUrl || !siteId || cart.items.length === 0) return;
    setCheckoutState("submitting");
    setErrorMessage(null);
    try {
      const response = await fetch(`${runtimeApiUrl}/v1/runtime/sites/${siteId}/cart-checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: cart.items.map((item) => ({ productId: item.productId, quantity: item.quantity })) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setErrorMessage(body?.error?.message ?? "Something went wrong — please try again.");
        setCheckoutState("error");
        return;
      }
      const body = (await response.json()) as { url: string };
      setCheckoutState("redirecting");
      setRedirectUrl(body.url);
    } catch {
      setErrorMessage("Something went wrong — please try again.");
      setCheckoutState("error");
    }
  }

  const toggleStyle: CSSProperties = {
    padding: `${cssVar("spacing", "xs")} ${cssVar("spacing", "element")}`,
    borderRadius: cssVar("radius", "control"),
    border: `1px solid ${cssVar("color", "border")}`,
    background: cssVar("color", "surface"),
    color: cssVar("color", "surface-foreground"),
    fontSize: cssVar("fontSize", "body"),
    cursor: "pointer",
  };
  const panelStyle: CSSProperties = {
    marginTop: cssVar("spacing", "xs"),
    padding: cssVar("spacing", "element"),
    borderRadius: cssVar("radius", "card"),
    border: `1px solid ${cssVar("color", "border")}`,
    background: cssVar("color", "surface"),
    color: cssVar("color", "surface-foreground"),
    display: "flex",
    flexDirection: "column",
    gap: cssVar("spacing", "sm"),
    maxWidth: "28rem",
  };
  const headingStyle: CSSProperties = { fontSize: cssVar("fontSize", "lg"), lineHeight: cssVar("lineHeight", "lg"), margin: 0 };
  const bodyStyle: CSSProperties = { fontSize: cssVar("fontSize", "body"), lineHeight: cssVar("lineHeight", "body"), margin: 0 };
  const lineRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: cssVar("spacing", "xs") };
  const lineTitleStyle: CSSProperties = { fontSize: cssVar("fontSize", "body"), lineHeight: cssVar("lineHeight", "body") };
  const lineMetaStyle: CSSProperties = { fontSize: cssVar("fontSize", "sm"), lineHeight: cssVar("lineHeight", "sm"), opacity: 0.7 };
  const qtyInputStyle: CSSProperties = {
    width: "3.5em",
    padding: cssVar("spacing", "xs"),
    borderRadius: cssVar("radius", "control"),
    border: `1px solid ${cssVar("color", "border")}`,
    background: cssVar("color", "background"),
    color: cssVar("color", "foreground"),
    fontSize: cssVar("fontSize", "sm"),
  };
  const removeButtonStyle: CSSProperties = {
    background: "none",
    border: "none",
    color: cssVar("color", "foreground"),
    cursor: "pointer",
    fontSize: cssVar("fontSize", "sm"),
    textDecoration: "underline",
  };
  const subtotalRowStyle: CSSProperties = { ...lineRowStyle, fontWeight: "bold", borderTop: `1px solid ${cssVar("color", "border")}`, paddingTop: cssVar("spacing", "xs") };
  const checkoutButtonStyle: CSSProperties = {
    padding: `${cssVar("spacing", "xs")} ${cssVar("spacing", "element")}`,
    borderRadius: cssVar("radius", "control"),
    border: "none",
    background: cssVar("color", "accent"),
    color: cssVar("color", "accent-foreground"),
    fontSize: cssVar("fontSize", "body"),
    cursor: "pointer",
  };
  const shippingNoteStyle: CSSProperties = { fontSize: cssVar("fontSize", "sm"), lineHeight: cssVar("lineHeight", "sm"), opacity: 0.7, margin: 0 };
  const warningStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "sm"),
    color: cssVar("color", "foreground"),
    border: `1px solid ${cssVar("color", "border")}`,
    borderRadius: cssVar("radius", "control"),
    padding: cssVar("spacing", "xs"),
  };

  const subtotal = cart.items.reduce((sum, item) => sum + lineTotal(item), 0);
  const currency = cart.items[0]?.currency ?? "usd";
  const requiresShipping = cart.items.some((item) => item.fulfillmentType === "physical");
  const canCheckout = Boolean(runtimeApiUrl && siteId) && cart.items.length > 0 && checkoutState !== "submitting" && checkoutState !== "redirecting";

  return (
    <div className="pf-block pf-cartdrawer" data-pf-block-type="cartdrawer" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      <button
        type="button"
        className="pf-cartdrawer-toggle"
        style={toggleStyle}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {heading} ({cart.ready ? cart.totalQuantity : 0})
      </button>
      {open ? (
        <div className="pf-cartdrawer-panel" style={panelStyle}>
          <h2 className="pf-cartdrawer-heading" style={headingStyle}>
            {heading}
          </h2>
          {justCompleted ? <p style={bodyStyle}>Thank you for your order!</p> : null}
          {cart.items.length === 0 ? (
            <p className="pf-cartdrawer-empty" style={bodyStyle}>
              {emptyMessage}
            </p>
          ) : (
            <>
              {cart.items.map((item) => (
                <div key={item.productId} className="pf-cartdrawer-line" style={lineRowStyle}>
                  <div>
                    <p className="pf-cartdrawer-line-title" style={lineTitleStyle}>
                      {item.title}
                    </p>
                    <p className="pf-cartdrawer-line-meta" style={lineMetaStyle}>
                      {formatPrice(item.price, item.currency)} each
                    </p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={item.quantity}
                    aria-label={`Quantity for ${item.title}`}
                    style={qtyInputStyle}
                    onChange={(event) => cart.setQuantity(item.productId, Math.max(1, Math.trunc(Number(event.target.value) || 1)))}
                  />
                  <span className="pf-cartdrawer-line-total" style={lineTitleStyle}>
                    {formatPrice(lineTotal(item), item.currency)}
                  </span>
                  <button type="button" style={removeButtonStyle} onClick={() => cart.removeItem(item.productId)}>
                    Remove
                  </button>
                </div>
              ))}
              <div className="pf-cartdrawer-subtotal" style={subtotalRowStyle}>
                <span>Subtotal</span>
                <span>{formatPrice(subtotal, currency)}</span>
              </div>
              {requiresShipping ? (
                <p className="pf-cartdrawer-shipping-note" style={shippingNoteStyle}>
                  Shipping calculated at checkout.
                </p>
              ) : null}
              {!runtimeApiUrl || !siteId ? (
                <p style={bodyStyle}>Checkout is available once this page is published.</p>
              ) : (
                <button type="button" style={checkoutButtonStyle} disabled={!canCheckout} onClick={() => void handleCheckout()}>
                  {checkoutState === "submitting" || checkoutState === "redirecting" ? "Redirecting…" : checkoutButtonLabel}
                </button>
              )}
              {checkoutState === "error" && errorMessage ? (
                <p style={warningStyle} role="alert">
                  {errorMessage}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
