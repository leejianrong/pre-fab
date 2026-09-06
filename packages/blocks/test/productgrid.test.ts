import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ProductGrid, productGridBlockDefinition, productGridDefaultProps, ProductGridPropsSchema } from "../src/productgrid/index.js";

const sampleProduct = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  slug: "mug",
  title: "Mug",
  price: 1500,
  currency: "usd",
  images: ["https://example.com/mug.png"],
  fulfillmentType: "physical" as const,
  stockCount: 5,
};

describe("ProductGrid block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(ProductGrid, { ...productGridDefaultProps, products: [sampleProduct], basePath: "shop" }));
    expect(html).toContain('data-pf-block-type="productgrid"');
    expect(html).toContain("Mug");
    expect(html).toContain('href="/shop/mug"');
    expect(html).toContain("$15.00");
  });

  it("renders an empty state with no products", () => {
    const html = renderToStaticMarkup(createElement(ProductGrid, { ...productGridDefaultProps, products: [] }));
    expect(html).toContain("No products yet");
  });

  it("renders no products data at all (inside the Puck canvas) without crashing", () => {
    const html = renderToStaticMarkup(createElement(ProductGrid, productGridDefaultProps));
    expect(html).toContain("No products yet");
  });

  it("hides the price when showPrice is false", () => {
    const html = renderToStaticMarkup(
      createElement(ProductGrid, { ...productGridDefaultProps, showPrice: false, products: [sampleProduct], basePath: "shop" }),
    );
    expect(html).not.toContain("pf-productgrid-item-price");
  });

  it("shows an out-of-stock indicator for a physical product with zero stock", () => {
    const html = renderToStaticMarkup(
      createElement(ProductGrid, {
        ...productGridDefaultProps,
        products: [{ ...sampleProduct, stockCount: 0 }],
        basePath: "shop",
      }),
    );
    expect(html).toContain("Out of stock");
  });

  it("never shows out-of-stock for a digital/service product regardless of stockCount", () => {
    const html = renderToStaticMarkup(
      createElement(ProductGrid, {
        ...productGridDefaultProps,
        products: [{ ...sampleProduct, fulfillmentType: "digital_or_service" as const, stockCount: null }],
        basePath: "shop",
      }),
    );
    expect(html).not.toContain("Out of stock");
  });

  it("shows pagination links only when there is more than one page", () => {
    const single = renderToStaticMarkup(
      createElement(ProductGrid, { ...productGridDefaultProps, products: [sampleProduct], basePath: "shop", pageNumber: 1, totalPages: 1 }),
    );
    expect(single).not.toContain("pf-productgrid-pagination");

    const multi = renderToStaticMarkup(
      createElement(ProductGrid, { ...productGridDefaultProps, products: [sampleProduct], basePath: "shop", pageNumber: 1, totalPages: 2 }),
    );
    expect(multi).toContain("pf-productgrid-pagination");
    expect(multi).toContain("Older");
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(ProductGrid, { ...productGridDefaultProps, products: [sampleProduct], basePath: "shop" }));
    expect(html).toMatch(/var\(--pf-fontSize-heading\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    expect(ProductGridPropsSchema.safeParse({ ...productGridDefaultProps, color: "#fff" }).success).toBe(false);
  });

  it("props schema clamps productsPerPage to [1, 50] and columns to [1, 4]", () => {
    expect(ProductGridPropsSchema.safeParse({ ...productGridDefaultProps, productsPerPage: 0 }).success).toBe(false);
    expect(ProductGridPropsSchema.safeParse({ ...productGridDefaultProps, productsPerPage: 51 }).success).toBe(false);
    expect(ProductGridPropsSchema.safeParse({ ...productGridDefaultProps, columns: 0 }).success).toBe(false);
    expect(ProductGridPropsSchema.safeParse({ ...productGridDefaultProps, columns: 5 }).success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(productGridBlockDefinition.version).toBe(1);
    expect(Object.keys(productGridBlockDefinition.migrations)).toHaveLength(0);
  });
});
