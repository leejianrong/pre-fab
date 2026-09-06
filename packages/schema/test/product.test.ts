import { describe, expect, it } from "vitest";
import { newUlid } from "../src/ids.js";
import { createEmptyProduct, isProductVisible, validateProductDocument } from "../src/product.js";

describe("createEmptyProduct", () => {
  it("starts as a draft at version 0, physical, with a zero stock count", () => {
    const product = createEmptyProduct({ id: newUlid(), siteId: newUlid(), slug: "mug", title: "Mug", price: 1500 });
    expect(product.status).toBe("draft");
    expect(product.version).toBe(0);
    expect(product.fulfillmentType).toBe("physical");
    expect(product.stockCount).toBe(0);
    expect(product.images).toEqual([]);
  });

  it("defaults stockCount to null for a digital/service product", () => {
    const product = createEmptyProduct({
      id: newUlid(),
      siteId: newUlid(),
      slug: "consult",
      title: "Consultation",
      price: 5000,
      fulfillmentType: "digital_or_service",
    });
    expect(product.stockCount).toBeNull();
  });
});

describe("isProductVisible", () => {
  it("is false for a draft", () => {
    expect(isProductVisible({ status: "draft" })).toBe(false);
  });

  it("is true for published — no date/scheduling gate, unlike a post (ADR-0018)", () => {
    expect(isProductVisible({ status: "published" })).toBe(true);
  });
});

describe("validateProductDocument", () => {
  it("accepts a well-formed physical product", () => {
    const product = createEmptyProduct({ id: newUlid(), siteId: newUlid(), slug: "mug", title: "Mug", price: 1500 });
    const result = validateProductDocument(product);
    expect(result.ok).toBe(true);
  });

  it("accepts a well-formed digital/service product", () => {
    const product = createEmptyProduct({
      id: newUlid(),
      siteId: newUlid(),
      slug: "consult",
      title: "Consultation",
      price: 5000,
      fulfillmentType: "digital_or_service",
    });
    const result = validateProductDocument(product);
    expect(result.ok).toBe(true);
  });

  it("rejects an empty title", () => {
    const product = createEmptyProduct({ id: newUlid(), siteId: newUlid(), slug: "mug", title: "", price: 1500 });
    expect(validateProductDocument(product).ok).toBe(false);
  });

  it("rejects a non-positive price", () => {
    const product = createEmptyProduct({ id: newUlid(), siteId: newUlid(), slug: "mug", title: "Mug", price: 0 });
    expect(validateProductDocument(product).ok).toBe(false);
  });

  it("rejects a physical product with a null stockCount", () => {
    const product = { ...createEmptyProduct({ id: newUlid(), siteId: newUlid(), slug: "mug", title: "Mug", price: 1500 }), stockCount: null };
    const result = validateProductDocument(product);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path.includes("stockCount"))).toBe(true);
  });

  it("rejects a digital/service product with a non-null stockCount", () => {
    const product = {
      ...createEmptyProduct({
        id: newUlid(),
        siteId: newUlid(),
        slug: "consult",
        title: "Consultation",
        price: 5000,
        fulfillmentType: "digital_or_service" as const,
      }),
      stockCount: 5,
    };
    const result = validateProductDocument(product);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path.includes("stockCount"))).toBe(true);
  });

  it("rejects a negative stockCount for a physical product", () => {
    const product = { ...createEmptyProduct({ id: newUlid(), siteId: newUlid(), slug: "mug", title: "Mug", price: 1500 }), stockCount: -1 };
    expect(validateProductDocument(product).ok).toBe(false);
  });
});
