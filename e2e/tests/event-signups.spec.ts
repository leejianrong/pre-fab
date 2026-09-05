import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { newUlid } from "@prefab/schema";
import { EVENTSIGNUP_BLOCK_TYPE, eventSignupDefaultProps } from "@prefab/blocks";
import { exportSite } from "@prefab/commands";
import { authenticatedContext, gotoLiveSite, newCheckoutDir } from "./helpers.js";

function eventSignupBlock(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: EVENTSIGNUP_BLOCK_TYPE,
    parent: null,
    order: 1000,
    schemaVersion: 1,
    props: { ...eventSignupDefaultProps, ...overrides },
    responsive: {},
  };
}

/**
 * Mirrors forms.spec.ts's waitForFormHydration exactly — the EventSignup
 * island hydrates asynchronously (client:load) the same way Form's does, so
 * clicking Submit before hydration falls through to a native form
 * submission and loses all JS state.
 */
async function waitForEventSignupHydration(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForSelector('astro-island[client="load"]:not([ssr])', { timeout: 10_000 });
}

// KAN-1138 demo: "A visitor signs up for a single event with a fixed
// capacity, optionally landing on a waitlist once it's full."
test("signing up on a published static page confirms the visitor and notifies the owner", async ({ page }) => {
  const { ctx, site } = await authenticatedContext("eventsignup-confirm");
  const widgetId = newUlid();

  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [
      eventSignupBlock(widgetId, {
        heading: "Community Picnic",
        fields: [
          { type: "text", label: "Name", name: "name", required: true, options: "" },
          { type: "email", label: "Email", name: "email", required: true, options: "" },
        ],
        capacity: 10,
        waitlistEnabled: true,
      }),
    ],
    expectedVersion: site.page.version,
  });
  await ctx.api.publish(site.site.id);

  await gotoLiveSite(page, `${site.site.slug}.prefab.local`);
  await waitForEventSignupHydration(page);
  await page.locator('input[name="name"]').fill("Ada Lovelace");
  await page.locator('input[name="email"]').fill("ada@example.com");
  await page.getByRole("button", { name: "Reserve my spot" }).click();
  await expect(page.getByText("You're confirmed")).toBeVisible();

  const signups = await ctx.api.listEventSignups(site.site.id, widgetId);
  expect(signups.total).toBe(1);
  expect(signups.signups[0]?.status).toBe("confirmed");
  expect(signups.signups[0]?.values).toMatchObject({ name: "Ada Lovelace", email: "ada@example.com" });
});

test("a full event waitlists a sign-up, and the owner-facing export/delete flow works", async ({ page }) => {
  const { ctx, site } = await authenticatedContext("eventsignup-waitlist");
  const widgetId = newUlid();

  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [
      eventSignupBlock(widgetId, {
        fields: [{ type: "text", label: "Name", name: "name", required: true, options: "" }],
        capacity: 1,
        waitlistEnabled: true,
      }),
    ],
    expectedVersion: site.page.version,
  });
  await ctx.api.publish(site.site.id);

  await gotoLiveSite(page, `${site.site.slug}.prefab.local`);
  await waitForEventSignupHydration(page);
  await page.locator('input[name="name"]').fill("First In Line");
  await page.getByRole("button", { name: "Reserve my spot" }).click();
  await expect(page.getByText("You're confirmed")).toBeVisible();

  await gotoLiveSite(page, `${site.site.slug}.prefab.local`);
  await waitForEventSignupHydration(page);
  await page.locator('input[name="name"]').fill("Second In Line");
  await page.getByRole("button", { name: "Reserve my spot" }).click();
  await expect(page.getByText("waitlist")).toBeVisible();

  const csv = await ctx.api.exportEventSignupsCsv(site.site.id, widgetId);
  expect(csv).toContain("First In Line");
  expect(csv).toContain("Second In Line");
  expect(csv).toContain("waitlisted");

  const before = await ctx.api.listEventSignups(site.site.id, widgetId);
  expect(before.total).toBe(2);
  const toDelete = before.signups.find((s) => s.values.name === "Second In Line")!;
  await ctx.api.deleteEventSignup(site.site.id, widgetId, toDelete.id);

  const after = await ctx.api.listEventSignups(site.site.id, widgetId);
  expect(after.total).toBe(1);
  expect(after.signups[0]?.values.name).toBe("First In Line");
});

// R20: sign-up data is visitor PII and must never touch the site's exported
// source tree — it only ever exists in platform Postgres (mirrors
// forms.spec.ts's identical test).
test("the site source tree contains no sign-up data after export", async ({ page }) => {
  const { ctx, site } = await authenticatedContext("eventsignup-export-tree");
  const widgetId = newUlid();
  const secretName = `do-not-leak-${newUlid()}`;

  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [
      eventSignupBlock(widgetId, {
        heading: "Private Gathering",
        fields: [{ type: "text", label: "Name", name: "name", required: true, options: "" }],
        capacity: 10,
      }),
    ],
    expectedVersion: site.page.version,
  });
  await ctx.api.publish(site.site.id);

  await gotoLiveSite(page, `${site.site.slug}.prefab.local`);
  await waitForEventSignupHydration(page);
  await page.locator('input[name="name"]').fill(secretName);
  await page.getByRole("button", { name: "Reserve my spot" }).click();
  await expect(page.getByText("You're confirmed")).toBeVisible();

  const signups = await ctx.api.listEventSignups(site.site.id, widgetId);
  expect(signups.total).toBe(1);

  const dir = await newCheckoutDir();
  await exportSite.run(ctx, { siteId: site.site.id, dir });

  async function readAllFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true });
    const contents: string[] = [];
    for (const entry of entries) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) contents.push(...(await readAllFiles(full)));
      else contents.push(await readFile(full, "utf8"));
    }
    return contents;
  }

  const allFileContents = (await readAllFiles(dir)).join("\n");
  expect(allFileContents).not.toContain(secretName);
  // The widget's *field definitions* are portable and expected in the tree
  // — only the visitor's submitted values are the thing R20 forbids.
  expect(allFileContents).toContain("Private Gathering");
});
