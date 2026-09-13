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

/**
 * KAN-1271: grid page and detail page have DIFFERENT slugs — the only
 * shape a real site can have, since `pages(site_id, slug)` is UNIQUE. This
 * fixture used to give both "shop", which hid the broken grid->detail
 * links this file now asserts on (blog.integration.test.ts's own fixture
 * had the identical flaw for the identical reason).
 */
const GRID_SLUG = "shop";
const DETAIL_SLUG = "item";

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
        { id: gridPageId, slug: GRID_SLUG },
        { id: detailPageId, slug: DETAIL_SLUG },
      ],
    },
    theme: { id: newUlid(), siteId, schemaVersion: 1, tokens: DEFAULT_THEME_TOKENS },
    pages: [
      {
        id: gridPageId,
        siteId,
        slug: GRID_SLUG,
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
        slug: DETAIL_SLUG,
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

    const detailHtml = await readFile(path.join(result.bundlePath, DETAIL_SLUG, "alpha", "index.html"), "utf8");
    expect(detailHtml).toContain("Alpha");
    expect(detailHtml).toContain('data-pf-block-type="productdetail"');
    expect(detailHtml).toContain("Add to cart");

    const gridPage1 = await readFile(path.join(result.bundlePath, GRID_SLUG, "index.html"), "utf8");
    // Alphabetical, 2 per page: page 1 has Alpha and Bravo.
    expect(gridPage1).toContain("Alpha");
    expect(gridPage1).toContain("Bravo");
    expect(gridPage1).not.toContain("Charlie");
    expect(gridPage1).toContain("pf-productgrid-pagination");

    const gridPage2 = await readFile(path.join(result.bundlePath, GRID_SLUG, "page", "2", "index.html"), "utf8");
    expect(gridPage2).toContain("Charlie");
  }, 60_000);

  // KAN-1271: the catalogue's half of the same regression test
  // blog.integration.test.ts carries — every grid link must resolve to a
  // route this same build actually wrote.
  it("emits product links that resolve to the detail page's real routes, not the grid page's own slug", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-shop-links-"));
    const products = [product({ slug: "alpha", title: "Alpha" }), product({ slug: "bravo", title: "Bravo" })];
    const { site, theme, pages } = shopSite(products);

    const result = await buildSiteBundle({ site, theme, pages, posts: [], products, baseUrl: "https://demo.prefab.app", bundleStoreDir });

    const gridHtml = await readFile(path.join(result.bundlePath, GRID_SLUG, "index.html"), "utf8");
    const hrefs = [...gridHtml.matchAll(/class="pf-productgrid-item-title"\s+href="([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs).toEqual(expect.arrayContaining([`/${DETAIL_SLUG}/alpha/`, `/${DETAIL_SLUG}/bravo/`]));
    expect(gridHtml).not.toContain(`href="/${GRID_SLUG}/alpha`);

    for (const href of hrefs) {
      const onDisk = path.join(result.bundlePath, href.replace(/^\//, ""), "index.html");
      await expect(readFile(onDisk, "utf8")).resolves.toContain('data-pf-block-type="productdetail"');
    }
  }, 60_000);

  it("builds correctly with zero products (empty grid, no detail routes)", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-shop-empty-"));
    const { site, theme, pages } = shopSite([]);

    const result = await buildSiteBundle({ site, theme, pages, posts: [], products: [], baseUrl: "https://demo.prefab.app", bundleStoreDir });
    const gridHtml = await readFile(path.join(result.bundlePath, GRID_SLUG, "index.html"), "utf8");
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

    const gridHtml = await readFile(path.join(result.bundlePath, GRID_SLUG, "index.html"), "utf8");
    expect(gridHtml).toContain("Visible product");

    const sitemap = await readFile(path.join(result.bundlePath, "sitemap.xml"), "utf8");
    // KAN-1262: trailing-slashed permalink, under the *detail* page's slug.
    expect(sitemap).toContain(`<loc>https://demo.prefab.app/${DETAIL_SLUG}/visible/</loc>`);
  }, 60_000);

  // KAN-1247 / ADR-0018 (part 4 addendum): the manifest apps/self-host
  // seeds its own SQLite `products` table from at start — mirrors
  // form.integration.test.ts's own "writes prefab-forms.json with every
  // Form block's publish-safe manifest, and nothing else" test.
  it("writes prefab-products.json with every product's publish-safe manifest, draft included", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-shop-manifest-"));
    const published = product({ slug: "published-item", title: "Published item", status: "published" });
    const draft = product({ slug: "draft-item", title: "Draft item", status: "draft", stockCount: 3 });
    const { site, theme, pages } = shopSite([published]);

    const result = await buildSiteBundle({
      site,
      theme,
      pages,
      posts: [],
      products: [published, draft],
      baseUrl: "https://demo.prefab.app",
      bundleStoreDir,
    });

    const productsJson = JSON.parse(await readFile(path.join(result.bundlePath, "prefab-products.json"), "utf8"));
    // Alphabetical by title (build-worker.ts's own sortProductsByTitle,
    // applied before extraction) — "Draft item" sorts before "Published
    // item" — proving this manifest respects the same pipeline-owned
    // ordering invariant every other collection here does.
    expect(productsJson).toEqual([
      {
        id: draft.id,
        siteId: draft.siteId,
        title: "Draft item",
        price: draft.price,
        currency: draft.currency,
        fulfillmentType: draft.fulfillmentType,
        stockCount: 3,
        successMessage: draft.successMessage,
        status: "draft",
      },
      {
        id: published.id,
        siteId: published.siteId,
        title: "Published item",
        price: published.price,
        currency: published.currency,
        fulfillmentType: published.fulfillmentType,
        stockCount: published.stockCount,
        successMessage: published.successMessage,
        status: "published",
      },
    ]);
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

    const gridHtml = await readFile(path.join(result.bundlePath, GRID_SLUG, "index.html"), "utf8");
    expect(gridHtml).toContain("Out of stock");

    const detailHtml = await readFile(path.join(result.bundlePath, DETAIL_SLUG, "sold-out", "index.html"), "utf8");
    expect(detailHtml).toContain("Out of stock");
  }, 60_000);
});
