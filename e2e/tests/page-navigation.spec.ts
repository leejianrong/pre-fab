import { test, expect } from "@playwright/test";
import { newUlid } from "@prefab/schema";
import { HERO_BLOCK_TYPE, heroDefaultProps } from "@prefab/blocks";
import { authenticatedContext, canvasFrame, loginInBrowser, openSiteByName } from "./helpers.js";

/**
 * KAN-1263: before this fix, SiteEditor.tsx always loaded `pages[0]` and
 * threw if a site had none — no picker, no "add page" affordance, no way
 * to reach or create a second page anywhere in the editor UI. That blocked
 * the blog (Post List + Post Detail) and product catalogue (Product Grid +
 * Product Detail) architectures from working through the no-code editor,
 * since both need two pages (packages/blocks/src/postdetail/schema.ts).
 *
 * This spec exercises the new "Pages" toolbar button/side sheet: seeing
 * every page and switching the canvas between them, creating a new page
 * from the editor (title only — the slug is auto-derived), and a page's
 * edits staying independent of any other page's.
 */
test.describe("page navigation (KAN-1263)", () => {
  test("switching pages shows each page's own content, and an edit on one page doesn't touch another", async ({ page }) => {
    const { ctx, site } = await authenticatedContext("page-nav");

    // A second page set up via the API, the same way blog.spec.ts/demo.spec.ts's
    // own fixtures are — this test is about navigating between pages already
    // reachable through the mutation, not about Puck's drag-and-drop.
    const servicesPage = await ctx.api.createPage(site.site.id, { slug: "services", title: "Services" });
    await ctx.api.writePage(site.site.id, servicesPage.id, {
      title: "Services",
      slug: "services",
      blocks: [
        {
          id: newUlid(),
          type: HERO_BLOCK_TYPE,
          parent: null,
          order: 1000,
          schemaVersion: 1,
          props: { ...heroDefaultProps, heading: "Services heading" },
          responsive: {},
        },
      ],
      expectedVersion: servicesPage.version,
    });

    await loginInBrowser(page);
    await openSiteByName(page, site.site.name);

    const frame = canvasFrame(page);
    // The site's default "Home" page (createSite's own Hero block) loads first.
    await expect(frame.getByText("Your headline goes here")).toBeVisible({ timeout: 15_000 });

    const header = page.locator("header").first();
    await header.getByRole("button", { name: /^pages$/i }).click();
    const pagesDialog = page.getByRole("dialog", { name: /site pages/i });
    await expect(pagesDialog).toBeVisible();
    await expect(pagesDialog.getByText("Home", { exact: true })).toBeVisible();
    await expect(pagesDialog.getByText("Services", { exact: true })).toBeVisible();

    await pagesDialog.getByText("Services", { exact: true }).click();
    await expect(pagesDialog).toBeHidden();

    await expect(frame.getByText("Services heading")).toBeVisible({ timeout: 10_000 });
    await expect(frame.getByText("Your headline goes here")).toHaveCount(0);

    // Edit Services' heading in the canvas and save — same technique demo.spec.ts uses.
    await frame.getByText("Services heading").click();
    const headingField = page.locator('input[name="heading"]:visible');
    await headingField.click();
    await headingField.press("Control+A");
    await headingField.type("Services heading, edited");
    await headingField.evaluate((el: HTMLInputElement) => el.blur());
    await header.getByRole("button", { name: /^save$/i }).click();
    await expect(header).toContainText("Saved", { timeout: 10_000 });
    await expect(frame.getByText("Services heading, edited")).toBeVisible();

    // Switch back to Home — unaffected by the Services edit.
    await header.getByRole("button", { name: /^pages$/i }).click();
    await pagesDialog.getByText("Home", { exact: true }).click();
    await expect(pagesDialog).toBeHidden();
    await expect(frame.getByText("Your headline goes here")).toBeVisible({ timeout: 10_000 });

    // Switch to Services again — the edit persisted independently of Home.
    await header.getByRole("button", { name: /^pages$/i }).click();
    await pagesDialog.getByText("Services", { exact: true }).click();
    await expect(pagesDialog).toBeHidden();
    await expect(frame.getByText("Services heading, edited")).toBeVisible({ timeout: 10_000 });

    // The server agrees with what the canvas showed on each page.
    const homeDoc = await ctx.api.getPage(site.site.id, site.page.id);
    expect(homeDoc.blocks.some((b) => JSON.stringify(b.props).includes("Your headline goes here"))).toBe(true);
    const servicesDoc = await ctx.api.getPage(site.site.id, servicesPage.id);
    expect(servicesDoc.blocks.some((b) => JSON.stringify(b.props).includes("Services heading, edited"))).toBe(true);
  });

  test("adding a page from the editor switches the canvas to it", async ({ page }) => {
    const { ctx, site } = await authenticatedContext("page-create");
    await loginInBrowser(page);
    await openSiteByName(page, site.site.name);

    const header = page.locator("header").first();
    await header.getByRole("button", { name: /^pages$/i }).click();
    const pagesDialog = page.getByRole("dialog", { name: /site pages/i });
    await pagesDialog.getByLabel(/page title/i).fill("About us");
    await pagesDialog.getByRole("button", { name: /\+ add page/i }).click();

    await expect(pagesDialog).toBeHidden({ timeout: 10_000 });
    await expect(header).toContainText("About us");

    // The slug was auto-derived from the title, never typed — page.create
    // still requires one, it's just not asked of a non-technical owner.
    const pages = await ctx.api.listPages(site.site.id);
    expect(pages.some((p) => p.title === "About us" && p.slug === "about-us")).toBe(true);
  });

  test("a site with no pages yet offers to create the first one instead of crashing", async ({ page, request }) => {
    // There's no page.delete mutation (by design — see PLAN.md), so a real
    // zero-page site can't be produced through the API. This proves the
    // client-side path SiteEditor.tsx used to hard-throw on
    // ("this site has no pages yet") now renders an empty-state screen
    // instead, by making listPages report zero pages every time the editor
    // asks, the same way a legitimately page-less site would.
    //
    // Every GET is faked, not just the first: apps/editor/src/main.tsx
    // mounts under React's <StrictMode>, which double-invokes an effect in
    // dev (mount, cleanup, mount again) — SiteEditor's own `cancelled` flag
    // discards the first run's *result*, but the GET it fired is still a
    // real request that reaches this route. Faking only the first one let
    // the second, un-faked request return the site's real one-page list
    // and load the normal canvas before the assertion below ever ran —
    // caught by CI (KAN-1263 PR #77), not by this comment on the first try.
    const { site } = await authenticatedContext("page-empty");

    await page.route(`**/v1/sites/${site.site.id}/pages`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        return;
      }
      await route.continue();
    });

    await loginInBrowser(page);
    await page.getByText(site.site.name).first().click();

    await expect(page.getByRole("heading", { name: /add your first page/i })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /\+ add a page/i }).click();

    const pagesDialog = page.getByRole("dialog", { name: /site pages/i });
    await expect(pagesDialog).toBeVisible();
    await pagesDialog.getByLabel(/page title/i).fill("Home");
    await pagesDialog.getByRole("button", { name: /\+ add page/i }).click();

    await expect(pagesDialog).toBeHidden({ timeout: 10_000 });
    const header = page.locator("header").first();
    await expect(header.getByRole("button", { name: /^publish$/i })).toBeVisible({ timeout: 10_000 });
    void request;
  });

  test("a duplicate page URL shows a clear error instead of crashing (KAN-1272)", async ({ page }) => {
    const { site } = await authenticatedContext("page-conflict");
    await loginInBrowser(page);
    await openSiteByName(page, site.site.name);

    // Forces the 409 path regardless of whether KAN-1272's server-side fix
    // has landed yet — this panel already dedupes the slug it sends
    // against the pages it knows about, so a genuine same-title collision
    // through this form alone isn't otherwise reachable.
    await page.route(`**/v1/sites/${site.site.id}/pages`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "conflict", message: "a page with that URL already exists" } }),
      });
    });

    const header = page.locator("header").first();
    await header.getByRole("button", { name: /^pages$/i }).click();
    const pagesDialog = page.getByRole("dialog", { name: /site pages/i });
    await pagesDialog.getByLabel(/page title/i).fill("Home");
    await pagesDialog.getByRole("button", { name: /\+ add page/i }).click();

    await expect(pagesDialog.getByText(/that page url is already taken/i)).toBeVisible({ timeout: 10_000 });
    // The panel stays open and usable — no unhandled rejection, no crash.
    await expect(pagesDialog).toBeVisible();
  });
});
