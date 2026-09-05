import { test, expect } from "@playwright/test";
import { API_URL, canvasFrame, loginInBrowser } from "./helpers.js";

// SLICES.md's headline demo: "Edit a heading in the browser... Publish. The
// live URL updates." — and the block renders identically in the canvas and
// the published output, the concrete WYSIWYG guarantee ADR-0004 asks for.
test("editing the Hero heading in the canvas, publishing, and loading the live URL shows the new text", async ({
  page,
  request,
}) => {
  await loginInBrowser(page);

  const siteName = `Demo ${Date.now()}`;
  await page.getByLabel(/^slug$/i).fill(`demo-${Date.now()}`);
  await page.getByLabel(/^name$/i).fill(siteName);
  await page.getByRole("button", { name: /create site/i }).click();

  await expect(page.locator("header").first()).toContainText(siteName, { timeout: 15_000 });

  const frame = canvasFrame(page);
  await expect(frame.getByText("Your headline goes here")).toBeVisible({ timeout: 15_000 });
  await frame.getByText("Your headline goes here").click();

  const headingField = page.locator('input[name="heading"]:visible');
  await headingField.click();
  await headingField.press("Control+A");
  await headingField.type("Live from the e2e suite");
  await headingField.evaluate((el: HTMLInputElement) => el.blur());

  const myHeader = page.locator("header").first();
  await myHeader.getByRole("button", { name: /^save$/i }).click();
  await expect(myHeader).toContainText("Saved", { timeout: 10_000 });

  // The canvas and the about-to-publish document must already agree —
  // this is the WYSIWYG check at the source, before publish even renders it.
  await expect(frame.getByText("Live from the e2e suite")).toBeVisible();
  await expect(frame.getByText("A sentence that says what you do and for whom.")).toBeVisible();
  await expect(frame.getByRole("link", { name: "Get in touch" })).toBeVisible();

  await myHeader.getByRole("button", { name: /^publish$/i }).click();
  await expect(myHeader).toContainText("Live", { timeout: 15_000 });

  const url = new URL(page.url());
  void url; // site id isn't in the URL (slice 1 has no router) — read it from the outline instead.

  // Resolve the live URL the same way any other client would: ask the API.
  const cookie = (await page.context().cookies()).find((c) => c.name === "prefab_session");
  expect(cookie).toBeDefined();

  const sitesResponse = await request.get(`${API_URL}/v1/sites`, { headers: { cookie: `${cookie!.name}=${cookie!.value}` } });
  const sites = await sitesResponse.json();
  const site = sites.find((s: { name: string }) => s.name === siteName);
  expect(site).toBeDefined();

  const liveResponse = await request.get(`${API_URL}/v1/sites/${site.id}/live/`, {
    headers: { cookie: `${cookie!.name}=${cookie!.value}` },
  });
  const liveHtml = await liveResponse.text();

  expect(liveHtml).toContain("Live from the e2e suite");
  expect(liveHtml).toContain("A sentence that says what you do and for whom.");
  expect(liveHtml).toContain("Get in touch");
  // Published output is fully static for a Hero-only page (ADR-0007) — no hydration script for it.
  expect(liveHtml).not.toMatch(/<script[^>]*type="module"/);
});
