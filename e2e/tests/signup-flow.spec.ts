import { test, expect } from "@playwright/test";
import { API_URL, EDITOR_URL } from "./helpers.js";

// SLICES.md Slice 3: "A stranger signs up... in under ten minutes,
// unassisted." This is the browser-driven half of that claim — signup,
// email verification and landing on a usable picker, with no seeded
// account involved (unlike every other spec in this suite, which uses
// dev/login).
test("signup, email verification, and landing on the site picker with a real session", async ({ page, request }) => {
  const email = `e2e-signup-${Date.now()}@example.com`;

  await page.goto(EDITOR_URL);
  await page.getByRole("button", { name: /first time\? create an account/i }).click();

  await page.getByLabel(/email address/i).fill(email);
  await page.getByRole("button", { name: /send me a code/i }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 10_000 });

  // Stand-in for "open the inbox" — the dev-only outbox the same real
  // signup endpoint writes to (apps/api/src/lib/email.ts).
  const emails = await request.get(`${API_URL}/v1/dev/emails?to=${encodeURIComponent(email)}`);
  const messages = (await emails.json()) as Array<{ text: string }>;
  expect(messages.length).toBeGreaterThan(0);
  const code = /\b(\d{6})\b/.exec(messages.at(-1)!.text)?.[1];
  expect(code).toBeDefined();

  await page.getByLabel(/verification code/i).fill(code!);
  await page.getByRole("button", { name: /verify and continue/i }).click();

  await page.waitForSelector("text=Your sites", { timeout: 15_000 });
  await expect(page.getByText(/no sites yet/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /start from a template/i })).toBeVisible();

  // The real session works exactly like dev/login's (SLICES.md: "built on
  // slice 1's identity primitive rather than replacing it").
  const cookie = (await page.context().cookies()).find((c) => c.name === "prefab_session");
  expect(cookie).toBeDefined();
  const sites = await request.get(`${API_URL}/v1/sites`, { headers: { cookie: `${cookie!.name}=${cookie!.value}` } });
  expect(sites.ok()).toBe(true);
  expect(await sites.json()).toEqual([]);
});

test("a wrong verification code is rejected with a visible error, and the correct one still works after", async ({
  page,
  request,
}) => {
  const email = `e2e-signup-bad-code-${Date.now()}@example.com`;

  await page.goto(EDITOR_URL);
  await page.getByRole("button", { name: /first time\? create an account/i }).click();
  await page.getByLabel(/email address/i).fill(email);
  await page.getByRole("button", { name: /send me a code/i }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 10_000 });

  await page.getByLabel(/verification code/i).fill("000000");
  await page.getByRole("button", { name: /verify and continue/i }).click();
  await expect(page.getByText(/invalid or expired/i)).toBeVisible({ timeout: 10_000 });

  const emails = await request.get(`${API_URL}/v1/dev/emails?to=${encodeURIComponent(email)}`);
  const code = /\b(\d{6})\b/.exec(((await emails.json()) as Array<{ text: string }>).at(-1)!.text)?.[1];

  await page.getByLabel(/verification code/i).fill(code!);
  await page.getByRole("button", { name: /verify and continue/i }).click();
  await page.waitForSelector("text=Your sites", { timeout: 15_000 });
});
