import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CartDrawer, cartDrawerBlockDefinition, cartDrawerDefaultProps, CartDrawerPropsSchema } from "../src/cartdrawer/index.js";

/**
 * KAN-1245 / ADR-0018 cart addendum. `useCart`'s own hydration effect never
 * runs under `renderToStaticMarkup` (React never executes effects during
 * SSR) — same limitation Payment/Booking's own tests live with for their
 * click-driven state. This suite covers what a pure SSR shape can prove:
 * the static shell, theme-token discipline, and schema validation. The
 * money-critical logic (createCartCheckout's own re-validation) has its own
 * dedicated coverage in packages/runtime/test/cart-checkout.test.ts.
 */
describe("CartDrawer block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004), shows a closed toggle with a (0) count before hydration", () => {
    const html = renderToStaticMarkup(createElement(CartDrawer, cartDrawerDefaultProps));
    expect(html).toContain('data-pf-block-type="cartdrawer"');
    expect(html).toContain("Your cart");
    expect(html).toContain("(0)");
    // The panel only ever opens via a client-side click, which never fires
    // during SSR — so the empty-cart message is never rendered server-side.
    expect(html).not.toContain(cartDrawerDefaultProps.emptyMessage);
  });

  it("uses the configured heading/checkoutButtonLabel", () => {
    const html = renderToStaticMarkup(
      createElement(CartDrawer, { ...cartDrawerDefaultProps, heading: "My Cart", checkoutButtonLabel: "Buy now" }),
    );
    expect(html).toContain("My Cart");
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(CartDrawer, cartDrawerDefaultProps));
    expect(html).toMatch(/var\(--pf-color-surface\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(html).not.toMatch(/rgba?\(/);
  });

  it("props schema accepts the default shape and rejects an unrecognised field", () => {
    expect(CartDrawerPropsSchema.safeParse(cartDrawerDefaultProps).success).toBe(true);
    expect(CartDrawerPropsSchema.safeParse({ ...cartDrawerDefaultProps, color: "#ff0000" }).success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(cartDrawerBlockDefinition.version).toBe(1);
    expect(Object.keys(cartDrawerBlockDefinition.migrations)).toHaveLength(0);
  });
});
