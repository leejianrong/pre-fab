import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ProductDetail, productDetailBlockDefinition, productDetailDefaultProps, ProductDetailPropsSchema } from "../src/productdetail/index.js";

const sampleProduct = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  title: "Mug",
  description: "# A heading\n\nA paragraph.\n\n- one\n- two",
  images: ["https://example.com/mug-1.png", "https://example.com/mug-2.png"],
  price: 1500,
  currency: "usd",
  fulfillmentType: "physical" as const,
  stockCount: 5,
  successMessage: "Thank you for your purchase.",
};

describe("ProductDetail block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(ProductDetail, { ...productDetailDefaultProps, product: sampleProduct }));
    expect(html).toContain('data-pf-block-type="productdetail"');
    expect(html).toContain("Mug");
    expect(html).toContain("A heading");
    expect(html).toContain("A paragraph.");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("$15.00");
    expect(html).toContain('src="https://example.com/mug-1.png"');
  });

  it("renders a placeholder with no product selected (inside the Puck canvas)", () => {
    const html = renderToStaticMarkup(createElement(ProductDetail, productDetailDefaultProps));
    expect(html).toContain("No product selected");
  });

  it("renders a working add-to-cart button for an in-stock product (KAN-1245 / ADR-0018 cart addendum)", () => {
    const html = renderToStaticMarkup(createElement(ProductDetail, { ...productDetailDefaultProps, product: sampleProduct }));
    expect(html).toContain("Add to cart");
    expect(html).not.toMatch(/<button[^>]*disabled/);
  });

  it("shows an out-of-stock indicator and disables add-to-cart for a physical product with zero stock", () => {
    const html = renderToStaticMarkup(
      createElement(ProductDetail, { ...productDetailDefaultProps, product: { ...sampleProduct, stockCount: 0 } }),
    );
    expect(html).toContain("Out of stock");
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("never shows out-of-stock for a digital/service product", () => {
    const html = renderToStaticMarkup(
      createElement(ProductDetail, {
        ...productDetailDefaultProps,
        product: { ...sampleProduct, fulfillmentType: "digital_or_service" as const, stockCount: null },
      }),
    );
    expect(html).not.toContain("Out of stock");
  });

  it("omits the image row when the product has none", () => {
    const html = renderToStaticMarkup(
      createElement(ProductDetail, { ...productDetailDefaultProps, product: { ...sampleProduct, images: [] } }),
    );
    expect(html).not.toContain("pf-productdetail-cover");
  });

  it("never uses dangerouslySetInnerHTML — description content is escaped by React, not parsed as markup", () => {
    const html = renderToStaticMarkup(
      createElement(ProductDetail, { ...productDetailDefaultProps, product: { ...sampleProduct, description: "<script>alert(1)</script>" } }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(ProductDetail, { ...productDetailDefaultProps, product: sampleProduct }));
    expect(html).toMatch(/var\(--pf-fontSize-heading\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema accepts no fields (no configurable props)", () => {
    expect(ProductDetailPropsSchema.safeParse({}).success).toBe(true);
    expect(ProductDetailPropsSchema.safeParse({ anything: true }).success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(productDetailBlockDefinition.version).toBe(1);
    expect(Object.keys(productDetailBlockDefinition.migrations)).toHaveLength(0);
  });
});
