import { test, expect } from "@playwright/test";
import { newUlid } from "@prefab/schema";
import {
  POSTLIST_BLOCK_TYPE,
  postListDefaultProps,
  POSTDETAIL_BLOCK_TYPE,
  postDetailDefaultProps,
  PRODUCTGRID_BLOCK_TYPE,
  productGridDefaultProps,
  PRODUCTDETAIL_BLOCK_TYPE,
  productDetailDefaultProps,
} from "@prefab/blocks";
import { authenticatedContext, gotoLiveSite } from "./helpers.js";

/**
 * KAN-1271. A list block and a detail block cannot live on the same page:
 * a `postdetail`/`productdetail` block turns its page into the per-item
 * route template, and `pages(site_id, slug)` is UNIQUE, so the list page
 * and the detail page necessarily have different slugs. Until this card,
 * both list blocks built each item's href from their OWN page's slug,
 * which therefore could never resolve — and no test anywhere clicked the
 * link, on either collection, so it shipped and was copied forward from
 * blog to catalogue.
 *
 * These two tests are the thing that was missing: a real separate list
 * page and detail page, a real publish, and a real browser click from the
 * list through to one specific item, landing on that item's own page.
 */

test("clicking a post in a Post List lands on that post's own detail page, on a separate page from the list", async ({ page }) => {
  const { ctx, site } = await authenticatedContext("list-detail-blog");
  const siteId = site.site.id;

  // Two pages, deliberately differently-slugged — the only shape the
  // database allows, and the one the old link generation could not serve.
  const listPage = await ctx.api.createPage(siteId, { slug: "journal", title: "Journal" });
  await ctx.api.writePage(siteId, listPage.id, {
    title: "Journal",
    slug: "journal",
    blocks: [
      {
        id: newUlid(),
        type: POSTLIST_BLOCK_TYPE,
        parent: null,
        order: 1000,
        schemaVersion: 1,
        props: { ...postListDefaultProps, heading: "Journal" },
        responsive: {},
      },
    ],
    expectedVersion: listPage.version,
  });

  const detailPage = await ctx.api.createPage(siteId, { slug: "article", title: "Article" });
  await ctx.api.writePage(siteId, detailPage.id, {
    title: "Article",
    slug: "article",
    blocks: [
      { id: newUlid(), type: POSTDETAIL_BLOCK_TYPE, parent: null, order: 1000, schemaVersion: 1, props: { ...postDetailDefaultProps }, responsive: {} },
    ],
    expectedVersion: detailPage.version,
  });

  const target = await ctx.api.createPost(siteId, {
    title: "The one we click",
    date: "2024-03-02",
    body: "Body text that only the clicked post's own detail page carries.",
    status: "published",
  });
  await ctx.api.createPost(siteId, { title: "The one we do not click", date: "2024-03-01", body: "Other body.", status: "published" });

  await ctx.api.publish(siteId);

  const hostname = `${site.site.slug}.prefab.local`;
  await gotoLiveSite(page, hostname);
  await page.goto(`http://${hostname}/journal/`);

  const link = page.getByRole("link", { name: "The one we click" });
  await expect(link).toBeVisible();
  // The href points at the DETAIL page's slug, never the list page's own.
  await expect(link).toHaveAttribute("href", `/article/${target.slug}/`);

  await link.click();

  await expect(page).toHaveURL(`http://${hostname}/article/${target.slug}/`);
  await expect(page.locator('[data-pf-block-type="postdetail"]')).toBeVisible();
  await expect(page.getByText("Body text that only the clicked post's own detail page carries.")).toBeVisible();
  await expect(page.getByText("Other body.")).toHaveCount(0);
});

test("clicking a product in a Product Grid lands on that product's own detail page, on a separate page from the grid", async ({ page }) => {
  const { ctx, site } = await authenticatedContext("list-detail-shop");
  const siteId = site.site.id;

  const gridPage = await ctx.api.createPage(siteId, { slug: "shop", title: "Shop" });
  await ctx.api.writePage(siteId, gridPage.id, {
    title: "Shop",
    slug: "shop",
    blocks: [
      {
        id: newUlid(),
        type: PRODUCTGRID_BLOCK_TYPE,
        parent: null,
        order: 1000,
        schemaVersion: 1,
        props: { ...productGridDefaultProps, heading: "Shop" },
        responsive: {},
      },
    ],
    expectedVersion: gridPage.version,
  });

  const detailPage = await ctx.api.createPage(siteId, { slug: "item", title: "Item" });
  await ctx.api.writePage(siteId, detailPage.id, {
    title: "Item",
    slug: "item",
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
    expectedVersion: detailPage.version,
  });

  const target = await ctx.api.createProduct(siteId, {
    title: "Enamel mug",
    description: "Description only the clicked product's own detail page carries.",
    price: 1800,
    stockCount: 4,
    status: "published",
  });
  await ctx.api.createProduct(siteId, { title: "Zinc kettle", description: "Other description.", price: 4200, stockCount: 2, status: "published" });

  await ctx.api.publish(siteId);

  const hostname = `${site.site.slug}.prefab.local`;
  await gotoLiveSite(page, hostname);
  await page.goto(`http://${hostname}/shop/`);

  const link = page.getByRole("link", { name: "Enamel mug" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", `/item/${target.slug}/`);

  await link.click();

  await expect(page).toHaveURL(`http://${hostname}/item/${target.slug}/`);
  await expect(page.locator('[data-pf-block-type="productdetail"]')).toBeVisible();
  await expect(page.getByText("Description only the clicked product's own detail page carries.")).toBeVisible();
  await expect(page.getByText("Other description.")).toHaveCount(0);
});

// KAN-1262's other half — a bare directory-style path (`/shop`, no
// trailing slash) redirecting to its canonical form instead of 500ing —
// is asserted at the HTTP layer, in apps/api's own integration suite
// ("redirects a bare directory-style path to its trailing-slash form
// instead of 500ing"), not here: `gotoLiveSite`'s request interception
// fulfils each response from inside the test process, and Chromium follows
// a redirect served that way without re-entering the route handler, so the
// follow-up request escapes the proxy and fails DNS. That is an artifact
// of the harness, not of the redirect (a real client follows it fine).
