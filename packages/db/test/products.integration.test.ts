import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newUlid } from "@prefab/schema";
import { createPool, runMigrations, withTenantContext } from "../src/index.js";
import { createAccount, createSite } from "../src/repositories/index.js";
import {
  createProduct,
  getProduct,
  listAllProductsForSite,
  listProductsForSite,
  listProductSlugsForSite,
  writeProduct,
} from "../src/repositories/products.js";

const migrateUrl = process.env.MIGRATE_DATABASE_URL_TEST;
const appUrl = process.env.DATABASE_URL_TEST;

if (!migrateUrl || !appUrl) {
  throw new Error("MIGRATE_DATABASE_URL_TEST and DATABASE_URL_TEST must be set — see .env.example and scripts/db-up.sh");
}

const migratePool = createPool(migrateUrl);
const appPool = createPool(appUrl);

beforeAll(async () => {
  await runMigrations(migratePool);
});

afterAll(async () => {
  await migratePool.end();
  await appPool.end();
});

async function makeSite(prefix: string) {
  const owner = await withTenantContext(migratePool, {}, (client) =>
    createAccount(client, { id: newUlid(), email: `${prefix}-${newUlid()}@example.com` }),
  );
  const site = await withTenantContext(appPool, { accountId: owner.id }, (client) =>
    createSite(client, { id: newUlid(), slug: `${prefix}-${newUlid()}`, name: prefix, ownerId: owner.id }),
  );
  return { owner, site };
}

describe("products under RLS (KAN-1244)", () => {
  it("a product created for one site is invisible under another site's context", async () => {
    const { site: siteA } = await makeSite("products-a");
    const { site: siteB } = await makeSite("products-b");

    const product = await withTenantContext(appPool, { siteId: siteA.id }, (client) =>
      createProduct(client, { id: newUlid(), siteId: siteA.id, slug: "mug", title: "Mug", price: 1500 }),
    );

    const fromB = await withTenantContext(appPool, { siteId: siteB.id }, (client) => getProduct(client, product.id));
    expect(fromB).toBeNull();

    const fromA = await withTenantContext(appPool, { siteId: siteA.id }, (client) => getProduct(client, product.id));
    expect(fromA?.id).toBe(product.id);
  });

  it("listAllProductsForSite under one site's context never returns another site's products", async () => {
    const { site: siteA } = await makeSite("products-list-a");
    const { site: siteB } = await makeSite("products-list-b");

    await withTenantContext(appPool, { siteId: siteA.id }, (client) =>
      createProduct(client, { id: newUlid(), siteId: siteA.id, slug: "a-product", title: "A product", price: 1000 }),
    );
    await withTenantContext(appPool, { siteId: siteB.id }, (client) =>
      createProduct(client, { id: newUlid(), siteId: siteB.id, slug: "b-product", title: "B product", price: 1000 }),
    );

    const productsForA = await withTenantContext(appPool, { siteId: siteA.id }, (client) => listAllProductsForSite(client, siteA.id));
    expect(productsForA).toHaveLength(1);
    expect(productsForA[0]!.slug).toBe("a-product");
  });
});

describe("fulfillment type / stock count pairing (ADR-0018)", () => {
  it("defaults a physical product to a zero stock count", async () => {
    const { site } = await makeSite("fulfillment-physical");
    const product = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createProduct(client, { id: newUlid(), siteId: site.id, slug: "physical-item", title: "Physical item", price: 2000 }),
    );
    expect(product.fulfillmentType).toBe("physical");
    expect(product.stockCount).toBe(0);
  });

  it("defaults a digital/service product to a null stock count", async () => {
    const { site } = await makeSite("fulfillment-digital");
    const product = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createProduct(client, {
        id: newUlid(),
        siteId: site.id,
        slug: "digital-item",
        title: "Digital item",
        price: 2000,
        fulfillmentType: "digital_or_service",
      }),
    );
    expect(product.stockCount).toBeNull();
  });

  it("the database rejects a physical product with a null stock count", async () => {
    const { site } = await makeSite("fulfillment-invalid");
    await expect(
      withTenantContext(appPool, { siteId: site.id }, (client) =>
        createProduct(client, {
          id: newUlid(),
          siteId: site.id,
          slug: "invalid-item",
          title: "Invalid item",
          price: 2000,
          fulfillmentType: "physical",
          stockCount: null,
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("listProductsForSite pagination boundaries", () => {
  it("orders alphabetically by title and paginates with a stable total", async () => {
    const { site } = await makeSite("pagination");
    const titles = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
    for (const title of titles) {
      await withTenantContext(appPool, { siteId: site.id }, (client) =>
        createProduct(client, { id: newUlid(), siteId: site.id, slug: title.toLowerCase(), title, price: 1000 }),
      );
    }

    const firstPage = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      listProductsForSite(client, site.id, { limit: 2, offset: 0 }),
    );
    expect(firstPage.total).toBe(5);
    expect(firstPage.products.map((p) => p.title)).toEqual(["Alpha", "Bravo"]);

    const lastPage = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      listProductsForSite(client, site.id, { limit: 2, offset: 4 }),
    );
    expect(lastPage.products.map((p) => p.title)).toEqual(["Echo"]);
  });

  it("filters by status when asked", async () => {
    const { site } = await makeSite("pagination-status");
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createProduct(client, { id: newUlid(), siteId: site.id, slug: "draft-item", title: "Draft", price: 1000, status: "draft" }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createProduct(client, {
        id: newUlid(),
        siteId: site.id,
        slug: "published-item",
        title: "Published",
        price: 1000,
        status: "published",
      }),
    );

    const published = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      listProductsForSite(client, site.id, { status: "published" }),
    );
    expect(published.products.map((p) => p.slug)).toEqual(["published-item"]);
  });
});

describe("listProductSlugsForSite", () => {
  it("returns every slug on the site, for dedupe-checking a new one", async () => {
    const { site } = await makeSite("slugs");
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createProduct(client, { id: newUlid(), siteId: site.id, slug: "first", title: "First", price: 1000 }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createProduct(client, { id: newUlid(), siteId: site.id, slug: "second", title: "Second", price: 1000 }),
    );

    const slugs = await withTenantContext(appPool, { siteId: site.id }, (client) => listProductSlugsForSite(client, site.id));
    expect(new Set(slugs)).toEqual(new Set(["first", "second"]));
  });
});

describe("writeProduct optimistic concurrency (ADR-0006/R17)", () => {
  it("rejects a stale write and leaves the prior write intact", async () => {
    const { site } = await makeSite("oc");
    const product = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createProduct(client, { id: newUlid(), siteId: site.id, slug: "oc-product", title: "OC", price: 1000 }),
    );

    const firstWrite = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      writeProduct(client, {
        productId: product.id,
        siteId: site.id,
        slug: "oc-product",
        title: "First edit",
        description: "",
        images: [],
        price: 1000,
        currency: "usd",
        fulfillmentType: "physical",
        stockCount: 0,
        successMessage: "Thank you for your purchase.",
        status: "draft",
        expectedVersion: 0,
      }),
    );
    expect(firstWrite.ok).toBe(true);

    const staleWrite = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      writeProduct(client, {
        productId: product.id,
        siteId: site.id,
        slug: "oc-product",
        title: "Stale edit",
        description: "",
        images: [],
        price: 1000,
        currency: "usd",
        fulfillmentType: "physical",
        stockCount: 0,
        successMessage: "Thank you for your purchase.",
        status: "draft",
        expectedVersion: 0,
      }),
    );
    expect(staleWrite.ok).toBe(false);
    if (!staleWrite.ok) {
      expect(staleWrite.current.title).toBe("First edit");
      expect(staleWrite.current.version).toBe(1);
    }
  });

  it("re-applying identical content is a no-op that never bumps version", async () => {
    const { site } = await makeSite("oc-noop");
    const product = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createProduct(client, { id: newUlid(), siteId: site.id, slug: "noop-product", title: "Noop", price: 1000 }),
    );

    const result = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      writeProduct(client, {
        productId: product.id,
        siteId: site.id,
        slug: product.slug,
        title: product.title,
        description: product.description,
        images: product.images,
        price: product.price,
        currency: product.currency,
        fulfillmentType: product.fulfillmentType,
        stockCount: product.stockCount,
        successMessage: product.successMessage,
        status: product.status,
        expectedVersion: 0,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.version).toBe(0);
  });
});
