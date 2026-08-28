import { createServer, type Server } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { newUlid } from "@prefab/schema";
import { exportSite } from "@prefab/commands";
import { API_URL, authenticatedContext, gotoLiveSite, newCheckoutDir } from "./helpers.js";

function formBlock(id: string) {
  return {
    id,
    type: "form",
    parent: null,
    order: 1000,
    schemaVersion: 1,
    props: {
      heading: "Contact us",
      fields: [
        { type: "text", label: "Name", name: "name", required: true, options: "" },
        { type: "email", label: "Email", name: "email", required: true, options: "" },
        { type: "textarea", label: "Message", name: "message", required: true, options: "" },
      ],
      submitLabel: "Submit",
      successMessage: "Thanks — we'll be in touch.",
      turnstileEnabled: false,
    },
    responsive: {},
  };
}

/**
 * The Form island hydrates asynchronously (client:load) — clicking Submit
 * before hydration attaches its onSubmit handler falls through to the
 * browser's native form submission (a full-page GET navigation with no
 * `action`), losing all JS state. Astro's own hydration runtime removes
 * the island's `ssr` attribute the instant hydration completes, so waiting
 * for that is a precise, framework-native signal rather than a guessed
 * timeout or "networkidle".
 */
async function waitForFormHydration(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForSelector('astro-island[client="load"]:not([ssr])', { timeout: 10_000 });
}

/** A tiny local HTTP server standing in for the owner's own webhook receiver. */
async function startWebhookReceiver(): Promise<{ url: string; received: () => unknown[]; close: () => Promise<void> }> {
  const received: unknown[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push(JSON.parse(body || "{}"));
      res.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("webhook receiver failed to bind");
  return {
    url: `http://127.0.0.1:${address.port}/hook`,
    received: () => received,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

// SLICES.md Slice 6 demo: "A visitor submits a contact form on a published
// site. The owner gets an email, sees the submission in their dashboard,
// exports it as CSV, and a webhook fires."
test("submitting a form on a published static page stores the record, emails the owner, and fires the webhook", async ({ page }) => {
  const { ctx, site } = await authenticatedContext("forms-submit");
  const formId = newUlid();
  const notifyEmail = `owner-${newUlid()}@example.com`;

  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [formBlock(formId)],
    expectedVersion: site.page.version,
  });

  const webhook = await startWebhookReceiver();
  await ctx.api.configureForm(site.site.id, formId, { notifyEmail, webhookUrl: webhook.url });
  await ctx.api.publish(site.site.id);

  try {
    await gotoLiveSite(page, `${site.site.slug}.prefab.local`);
    await waitForFormHydration(page);
    await page.locator('input[name="name"]').fill("Ada Lovelace");
    await page.locator('input[name="email"]').fill("ada@example.com");
    await page.locator('textarea[name="message"]').fill("Hello from the published page!");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Thanks — we'll be in touch.")).toBeVisible();

    const submissions = await ctx.api.listSubmissions(site.site.id, formId);
    expect(submissions.total).toBe(1);
    expect(submissions.submissions[0]?.values).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.com",
      message: "Hello from the published page!",
    });

    const emails = (await (await fetch(`${API_URL}/v1/dev/emails?to=${encodeURIComponent(notifyEmail)}`)).json()) as unknown[];
    expect(emails.length).toBeGreaterThan(0);

    await expect.poll(() => webhook.received().length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(webhook.received()[0]).toMatchObject({ formId, event: "form.submission.created" });
  } finally {
    await webhook.close();
  }
});

test("submissions export as CSV and a single record can be deleted", async ({ page }) => {
  const { ctx, site } = await authenticatedContext("forms-export");
  const formId = newUlid();

  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [formBlock(formId)],
    expectedVersion: site.page.version,
  });
  await ctx.api.publish(site.site.id);

  for (const [name, email] of [
    ["Grace Hopper", "grace@example.com"],
    ["Alan Turing", "alan@example.com"],
  ]) {
    await gotoLiveSite(page, `${site.site.slug}.prefab.local`);
    await waitForFormHydration(page);
    await page.locator('input[name="name"]').fill(name!);
    await page.locator('input[name="email"]').fill(email!);
    await page.locator('textarea[name="message"]').fill("Hi there");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Thanks — we'll be in touch.")).toBeVisible();
  }

  const csv = await ctx.api.exportSubmissionsCsv(site.site.id, formId);
  expect(csv).toContain("Grace Hopper");
  expect(csv).toContain("Alan Turing");
  expect(csv.split("\r\n").filter(Boolean)).toHaveLength(3); // header + 2 rows

  const before = await ctx.api.listSubmissions(site.site.id, formId);
  expect(before.total).toBe(2);
  const toDelete = before.submissions.find((s) => s.values.name === "Grace Hopper")!;
  await ctx.api.deleteSubmission(site.site.id, formId, toDelete.id);

  const after = await ctx.api.listSubmissions(site.site.id, formId);
  expect(after.total).toBe(1);
  expect(after.submissions[0]?.values.name).toBe("Alan Turing");
});

// R20: submission data is visitor PII and must never touch the site's
// exported source tree — it only ever exists in platform Postgres.
test("the site source tree contains no submission data after export", async ({ page }) => {
  const { ctx, site } = await authenticatedContext("forms-export-tree");
  const formId = newUlid();
  const secretMessage = `do-not-leak-${newUlid()}`;

  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [formBlock(formId)],
    expectedVersion: site.page.version,
  });
  await ctx.api.publish(site.site.id);

  await gotoLiveSite(page, `${site.site.slug}.prefab.local`);
  await waitForFormHydration(page);
  await page.locator('input[name="name"]').fill("Secret Visitor");
  await page.locator('input[name="email"]').fill("secret@example.com");
  await page.locator('textarea[name="message"]').fill(secretMessage);
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Thanks — we'll be in touch.")).toBeVisible();

  const submissions = await ctx.api.listSubmissions(site.site.id, formId);
  expect(submissions.total).toBe(1);

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
  expect(allFileContents).not.toContain(secretMessage);
  expect(allFileContents).not.toContain("secret@example.com");
  // The form's *field definitions* are portable and expected in the tree —
  // only the visitor's submitted values are the thing R20 forbids.
  expect(allFileContents).toContain("Contact us");
});
