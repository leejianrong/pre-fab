import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newUlid, DEFAULT_THEME_TOKENS, type ProductDocument } from "@prefab/schema";
import { PRODUCTGRID_BLOCK_TYPE, productGridDefaultProps, PRODUCTDETAIL_BLOCK_TYPE, productDetailDefaultProps } from "@prefab/blocks";
import { buildSiteBundle } from "../src/build.js";

let bundleStoreDir: string;

afterEach(async () => {
  if (bundleStoreDir) await rm(bundleStoreDir, { recursive: true, force: true });
});

function product(overrides: Partial<ProductDocument> = {}): ProductDocument {
  return {
    id: newUlid(),
    siteId: "site",
    slug: overrides.slug ?? "product",
    title: overrides.title ?? "A product",
    schemaVersion: 1,
    version: 0,
    description: overrides.description ?? "Description text.",
    images: overrides.images ?? [],
    price: overrides.price ?? 1500,
    currency: overrides.currency ?? "usd",
    fulfillmentType: overrides.fulfillmentType ?? "physical",
    stockCount: overrides.stockCount !== undefined ? overrides.stockCount : 5,
    successMessage: overrides.successMessage ?? "Thank you for your purchase.",
    status: overrides.status ?? "published",
    ...overrides,
  };
}

function shopSite(products: ProductDocument[], productsPerPage = 12) {
  const siteId = newUlid();
  const gridPageId = newUlid();
  const detailPageId = newUlid();
  return {
    site: {
      id: siteId,
      slug: "demo",
      name: "Demo Shop",
      ownerId: newUlid(),
      schemaVersion: 1,
      pages: [
        { id: gridPageId, slug: "shop" },
        { id: detailPageId, slug: "shop" },
      ],
    },
    theme: { id: newUlid(), siteId, schemaVersion: 1, tokens: DEFAULT_THEME_TOKENS },
    pages: [
      {
        id: gridPageId,
        siteId,
        slug: "shop",
        title: "Shop",
        schemaVersion: 1,
        version: 0,
        blocks: [
          {
            id: newUlid(),
            type: PRODUCTGRID_BLOCK_TYPE,
            parent: null,
            order: 1000,
            schemaVersion: 1,
            props: { ...productGridDefaultProps, productsPerPage },
            responsive: {},
          },
        ],
      },
      {
        id: detailPageId,
        siteId,
        slug: "shop",
        title: "Product",
        schemaVersion: 1,
        version: 0,
        blocks: [
          {
            id: newUlid(),
            type: PRODUCTDETAIL_BLOCK_TYPE,
            parent: null,
            order: 1000,
            schemaVersion: 1,
            props: { ...productDetailDefaultProps },
            responsive: {},
          },
        ],
      },
    ],
    products,
  };
}

describe("product catalogue publish (KAN-1244 / ADR-0018): grid/detail routing, sitemap", () => {
  it("generates a detail route per product and a grid route with pagination", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-shop-"));
    const products = [
      product({ slug: "alpha", title: "Alpha" }),
      product({ slug: "bravo", title: "Bravo" }),
      product({ slug: "charlie", title: "Charlie" }),
    ];
    const { site, theme, pages } = shopSite(products, 2);

    const result = await buildSiteBundle({ site, theme, pages, posts: [], products, baseUrl: "https://demo.prefab.app", bundleStoreDir });

    const detailHtml = await readFile(path.join(result.bundlePath, "shop", "alpha", "index.html"), "utf8");
    expect(detailHtml).toContain("Alpha");
    expect(detailHtml).toContain('data-pf-block-type="productdetail"');
    expect(detailHtml).toContain("Add to cart");

    const gridPage1 = await readFile(path.join(result.bundlePath, "shop", "index.html"), "utf8");
    // Alphabetical, 2 per page: page 1 has Alpha and Bravo.
    expect(gridPage1).toContain("Alpha");
    expect(gridPage1).toContain("Bravo");
    expect(gridPage1).not.toContain("Charlie");
    expect(gridPage1).toContain("pf-productgrid-pagination");

    const gridPage2 = await readFile(path.join(result.bundlePath, "shop", "page", "2", "index.html"), "utf8");
    expect(gridPage2).toContain("Charlie");
  }, 60_000);

  it("builds correctly with zero products (empty grid, no detail routes)", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-shop-empty-"));
    const { site, theme, pages } = shopSite([]);

    const result = await buildSiteBundle({ site, theme, pages, posts: [], products: [], baseUrl: "https://demo.prefab.app", bundleStoreDir });
    const gridHtml = await readFile(path.join(result.bundlePath, "shop", "index.html"), "utf8");
    expect(gridHtml).toContain("No products yet");
  }, 60_000);

  it("only ever routes/feeds the products it was handed — visibility filtering is the caller's job, not this pipeline's", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-shop-filtered-"));
    const visibleProduct = product({ slug: "visible", title: "Visible product", status: "published" });
    // A draft product the caller decided NOT to pass in at all —
    // simulating apps/api's publish.create filtering before this call.
    const { site, theme, pages } = shopSite([visibleProduct]);

    const result = await buildSiteBundle({
      site,
      theme,
      pages,
      posts: [],
      products: [visibleProduct],
      baseUrl: "https://demo.prefab.app",
      bundleStoreDir,
    });

    const gridHtml = await readFile(path.join(result.bundlePath, "shop", "index.html"), "utf8");
    expect(gridHtml).toContain("Visible product");

    const sitemap = await readFile(path.join(result.bundlePath, "sitemap.xml"), "utf8");
    expect(sitemap).toContain("https://demo.prefab.app/shop/visible");
  }, 60_000);

  it("shows an out-of-stock indicator for a physical product with zero stock, on both grid and detail", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-shop-oos-"));
    const outOfStock = product({ slug: "sold-out", title: "Sold out item", stockCount: 0 });
    const { site, theme, pages } = shopSite([outOfStock]);

    const result = await buildSiteBundle({
      site,
      theme,
      pages,
      posts: [],
      products: [outOfStock],
      baseUrl: "https://demo.prefab.app",
      bundleStoreDir,
    });

    const gridHtml = await readFile(path.join(result.bundlePath, "shop", "index.html"), "utf8");
    expect(gridHtml).toContain("Out of stock");

    const detailHtml = await readFile(path.join(result.bundlePath, "shop", "sold-out", "index.html"), "utf8");
    expect(detailHtml).toContain("Out of stock");
  }, 60_000);
});
