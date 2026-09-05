import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Payment, paymentBlockDefinition, paymentDefaultProps, PaymentPropsSchema } from "../src/index.js";

describe("Payment block", () => {
  it("server-renders with react-dom/server — proof it never touches window/document (ADR-0004 SSR-safety)", () => {
    const html = renderToStaticMarkup(createElement(Payment, paymentDefaultProps));
    expect(html).toContain(paymentDefaultProps.heading);
    expect(html).toContain('data-pf-block-type="payment"');
  });

  it("renders the static shell (no runtimeApiUrl) with a message rather than a live pay button", () => {
    const html = renderToStaticMarkup(createElement(Payment, paymentDefaultProps));
    expect(html).toContain("Payment is available once this page is published.");
  });

  it("references theme tokens via CSS custom properties, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(Payment, { ...paymentDefaultProps, runtimeApiUrl: "https://api.example.com", blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }));
    expect(html).toMatch(/var\(--pf-color-accent\)/);
    expect(html).toMatch(/var\(--pf-color-foreground\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(html).not.toMatch(/rgba?\(/);
  });

  it("formats the amount from cents using the configured currency", () => {
    const html = renderToStaticMarkup(createElement(Payment, { ...paymentDefaultProps, amount: 2599, currency: "usd" }));
    expect(html).toMatch(/\$25\.99/);
  });

  it("shows the live pay button once runtimeApiUrl/blockId are present", () => {
    const html = renderToStaticMarkup(createElement(Payment, { ...paymentDefaultProps, runtimeApiUrl: "https://api.example.com", blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }));
    expect(html).toContain(paymentDefaultProps.buttonLabel);
    expect(html).not.toContain("Payment is available once this page is published.");
  });

  it("props schema rejects an unrecognised field", () => {
    const result = PaymentPropsSchema.safeParse({ ...paymentDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("props schema rejects a non-positive amount", () => {
    expect(PaymentPropsSchema.safeParse({ ...paymentDefaultProps, amount: 0 }).success).toBe(false);
    expect(PaymentPropsSchema.safeParse({ ...paymentDefaultProps, amount: -100 }).success).toBe(false);
  });

  it("props schema rejects an uppercase or non-3-letter currency code", () => {
    expect(PaymentPropsSchema.safeParse({ ...paymentDefaultProps, currency: "USD" }).success).toBe(false);
    expect(PaymentPropsSchema.safeParse({ ...paymentDefaultProps, currency: "us" }).success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(paymentBlockDefinition.version).toBe(1);
    expect(Object.keys(paymentBlockDefinition.migrations)).toHaveLength(0);
  });
});
