import { describe, expect, it } from "vitest";
import { newUlid } from "../src/ids.js";
import { createEmptyProduct, type ProductDocument } from "../src/product.js";
import { parseProductFile, ProductFileParseError, serializeProductFile } from "../src/product-file.js";

function sampleProduct(overrides: Partial<ProductDocument> = {}): ProductDocument {
  return {
    ...createEmptyProduct({ id: newUlid(), siteId: newUlid(), slug: "mug", title: "Mug: The Original", price: 1500 }),
    images: ["https://example.com/mug-1.png", "https://example.com/mug-2.png"],
    status: "published",
    description: "First paragraph.\n\nSecond paragraph with more text.",
    ...overrides,
  };
}

describe("product file round trip (mirrors post-file.ts's rich-text/frontmatter round-trip fidelity)", () => {
  it("serializes then parses back to an identical document", () => {
    const product = sampleProduct();
    const file = parseProductFile(serializeProductFile(product));
    expect(file).toEqual(product);
  });

  it("round-trips a digital/service product with a null stockCount", () => {
    const product = sampleProduct({ fulfillmentType: "digital_or_service", stockCount: null });
    expect(parseProductFile(serializeProductFile(product))).toEqual(product);
  });

  it("round-trips a product with no images and a draft status", () => {
    const product = sampleProduct({ images: [], status: "draft" });
    expect(parseProductFile(serializeProductFile(product))).toEqual(product);
  });

  it("round-trips a title containing a colon", () => {
    const product = sampleProduct({ title: "Mug: A Subtitle" });
    expect(parseProductFile(serializeProductFile(product))).toEqual(product);
  });

  it("produces a human-editable frontmatter block", () => {
    const file = serializeProductFile(sampleProduct());
    expect(file).toMatch(/^---\n/);
    expect(file).toContain("title: Mug: The Original");
    expect(file).toContain("fulfillmentType: physical");
    expect(file).toContain("status: published");
  });

  it("rejects a file missing the frontmatter delimiter", () => {
    expect(() => parseProductFile("title: no delimiter\n\ndescription")).toThrow(ProductFileParseError);
  });

  it("rejects a file missing a required field", () => {
    const brokenFile = "---\nid: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n---\n\ndescription";
    expect(() => parseProductFile(brokenFile)).toThrow(/missing required field/);
  });
});
