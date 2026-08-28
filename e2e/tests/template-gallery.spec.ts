import { test, expect } from "@playwright/test";
import { canvasFrame, loginInBrowser } from "./helpers.js";

const TEMPLATE_NAME = "Independent Consultant";
const ORIGINAL_HEADING = "Strategy and operations consulting for growing teams";

async function forkTemplate(page: import("@playwright/test").Page, slugSuffix: string) {
  await page.getByRole("heading", { name: /start from a template/i }).waitFor();
  const card = page.locator("li", { hasText: TEMPLATE_NAME });
  await card.getByRole("button", { name: /use this template/i }).click();

  await page.getByLabel(/site slug/i).fill(`consultant-fork-${slugSuffix}`);
  await page.getByLabel(/site name/i).fill(`Consultant Fork ${slugSuffix}`);
  await page.getByRole("button", { name: /create my site/i }).click();
  await page.waitForSelector('button:has-text("Publish")', { timeout: 15_000 });
}

// SLICES.md Slice 3: "Forking a template twice yields two independent
// sites; editing one does not affect the other." — ADR-0011's fork-on-use
// contract, exercised end to end through the real gallery UI rather than
// only at the API layer (covered separately in apps/api's integration
// tests).
test("forking a template shows a guided first-edit banner and the template's real content", async ({ page }) => {
  await loginInBrowser(page);
  await forkTemplate(page, `${Date.now()}`);

  await expect(page.getByText(/try editing the heading below/i)).toBeVisible();

  const frame = canvasFrame(page);
  await expect(frame.getByText(ORIGINAL_HEADING)).toBeVisible({ timeout: 15_000 });
});

test("forking the same template twice yields two independent sites — editing one leaves the other untouched", async ({
  page,
}) => {
  await loginInBrowser(page);

  const suffix = Date.now();
  await forkTemplate(page, `a-${suffix}`);

  const frame = canvasFrame(page);
  await expect(frame.getByText(ORIGINAL_HEADING)).toBeVisible({ timeout: 15_000 });
  await frame.getByText(ORIGINAL_HEADING).click();

  const headingField = page.locator('input[name="heading"]:visible');
  await headingField.click();
  await headingField.press("Control+A");
  await headingField.type("Edited only on fork A");
  await headingField.evaluate((el: HTMLInputElement) => el.blur());

  const header = page.locator("header").first();
  await header.getByRole("button", { name: /^save$/i }).click();
  await expect(header).toContainText("Saved", { timeout: 10_000 });
  await expect(frame.getByText("Edited only on fork A")).toBeVisible();

  await header.getByRole("button", { name: /sites/i }).click();
  await forkTemplate(page, `b-${suffix}`);

  const frameB = canvasFrame(page);
  await expect(frameB.getByText(ORIGINAL_HEADING)).toBeVisible({ timeout: 15_000 });
  await expect(frameB.getByText("Edited only on fork A")).not.toBeVisible();
});
