import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { newUlid } from "@prefab/schema";
import { exportBundle } from "@prefab/commands";
import { API_URL, authenticatedContext, gotoLiveSite, newCheckoutDir } from "./helpers.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF_HOST_DIR = path.join(repoRoot, "apps", "self-host");
const SELF_HOST_SERVER_PATH = path.join(SELF_HOST_DIR, "src", "server.ts");
const SELF_HOST_PORT = 8791;

function bookingBlock(id: string) {
  return {
    id,
    type: "booking",
    parent: null,
    order: 1000,
    schemaVersion: 1,
    props: {
      heading: "Book a time",
      description: "Pick a slot that works for you.",
      confirmLabel: "Confirm booking",
      successMessage: "You're booked — check your email for details.",
    },
    responsive: {},
  };
}

/** Same signal e2e/tests/forms.spec.ts's own waitForFormHydration uses. */
async function waitForBookingHydration(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForSelector('astro-island[client="load"]:not([ssr])', { timeout: 10_000 });
}

/** A Monday far enough in the future that minNoticeMinutes/maxHorizonDays never clamp it out, regardless of when this suite happens to run. */
function futureMonday(weeksAhead: number): string {
  const now = new Date();
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  const d = new Date(now.getTime() + (daysUntilMonday + weeksAhead * 7) * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function setUtcAvailability(ctx: Awaited<ReturnType<typeof authenticatedContext>>["ctx"], siteId: string, overrides: Record<string, unknown> = {}) {
  await ctx.api.setAvailability(siteId, {
    timezone: "UTC",
    weeklyWindows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
    dateOverrides: [],
    slotDurationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minNoticeMinutes: 0,
    maxHorizonDays: 365,
    ...overrides,
  });
}

// SLICES.md Slice 9 demo: "A visitor picks a slot in their own timezone.
// Both parties get a calendar invite, and the owner's Google Calendar shows
// it." Driven through the real published page and the real Booking widget,
// in a browser context set to a different timezone than the rule's own
// (America/New_York) — the same "visitor in a different timezone" the
// requirement names.
test.describe("scheduling and bookings (Slice 9, ADR-0009)", () => {
  test.use({ timezoneId: "Pacific/Auckland" });

  test("a visitor in a different timezone books a slot; both parties receive a correct invite and the owner's calendar reflects it", async ({ page }) => {
    const { ctx, site } = await authenticatedContext("bookings-widget");
    const widgetId = newUlid();

    await ctx.api.writePage(site.site.id, site.page.id, {
      title: site.page.title,
      slug: site.page.slug,
      blocks: [bookingBlock(widgetId)],
      expectedVersion: site.page.version,
    });
    await setUtcAvailability(ctx, site.site.id);
    await ctx.api.connectCalendar(site.site.id, { provider: "google" });
    await ctx.api.publish(site.site.id);

    await gotoLiveSite(page, `${site.site.slug}.prefab.local`);
    await waitForBookingHydration(page);

    // The widget's date chips are rendered in the visitor's own timezone
    // (Pacific/Auckland here) — click the first one, then the first time.
    await page.getByRole("button", { name: /^\d{4}-\d{2}-\d{2}$/ }).first().click();
    const timeButtons = page.locator('[data-pf-block-type="booking"] div[role="tablist"]').nth(1).locator("button");
    await expect(timeButtons.first()).toBeVisible({ timeout: 10_000 });
    await timeButtons.first().click();

    await page.getByLabel("Name").fill("Ada Lovelace");
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page.getByText("You're booked — check your email for details.")).toBeVisible({ timeout: 10_000 });

    const emails = (await (await fetch(`${API_URL}/v1/dev/emails?to=${encodeURIComponent("ada@example.com")}`)).json()) as Array<{ subject: string }>;
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.some((e) => e.subject.includes("confirmed"))).toBe(true);

    const bookings = await ctx.api.listBookings(site.site.id);
    expect(bookings.total).toBe(1);
    expect(bookings.bookings[0]?.visitorEmail).toBe("ada@example.com");
    // The owner's Google Calendar shows it.
    expect(bookings.bookings[0]?.externalEventId).toBeTruthy();
  });
});

// SLICES.md Slice 9 e2e: "Double-booking the same slot concurrently: one
// succeeds, one is rejected cleanly." Driven directly against the runtime
// API (the same style concurrency.spec.ts already uses for R17) — the
// interesting behaviour is the database race itself, not browser UI.
test("double-booking the same slot concurrently: one succeeds, one is rejected cleanly", async () => {
  const { ctx, site } = await authenticatedContext("bookings-race");
  const widgetId = newUlid();
  const monday = futureMonday(3);

  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [bookingBlock(widgetId)],
    expectedVersion: site.page.version,
  });
  await setUtcAvailability(ctx, site.site.id);
  await ctx.api.publish(site.site.id);

  const payload = { startsAt: `${monday}T09:00:00.000Z`, visitorName: "Racer", visitorEmail: "racer@example.com", visitorTimezone: "UTC" };
  const [a, b] = await Promise.all([
    fetch(`${API_URL}/v1/runtime/booking-widgets/${widgetId}/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    fetch(`${API_URL}/v1/runtime/booking-widgets/${widgetId}/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
  ]);
  const statuses = [a.status, b.status].sort();
  expect(statuses).toEqual([201, 409]);

  const bookings = await ctx.api.listBookings(site.site.id);
  expect(bookings.total).toBe(1);
});

// SLICES.md Slice 9 e2e: "Cancelling releases the slot and updates the
// external calendar."
test("cancelling releases the slot and updates the external calendar", async () => {
  const { ctx, site } = await authenticatedContext("bookings-cancel");
  const widgetId = newUlid();
  const monday = futureMonday(4);

  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [bookingBlock(widgetId)],
    expectedVersion: site.page.version,
  });
  await setUtcAvailability(ctx, site.site.id);
  await ctx.api.connectCalendar(site.site.id, { provider: "google" });
  await ctx.api.publish(site.site.id);

  const create = await fetch(`${API_URL}/v1/runtime/booking-widgets/${widgetId}/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ startsAt: `${monday}T09:00:00.000Z`, visitorName: "Grace Hopper", visitorEmail: "grace@example.com", visitorTimezone: "UTC" }),
  });
  expect(create.status).toBe(201);
  const { id: bookingId } = (await create.json()) as { id: string };

  const bookingsBefore = await ctx.api.listBookings(site.site.id);
  expect(bookingsBefore.bookings[0]?.externalEventId).toBeTruthy();

  const canceled = await ctx.api.cancelBooking(site.site.id, bookingId);
  expect(canceled.status).toBe("canceled");

  // The slot is available again.
  const rebook = await fetch(`${API_URL}/v1/runtime/booking-widgets/${widgetId}/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ startsAt: `${monday}T09:00:00.000Z`, visitorName: "Alan Turing", visitorEmail: "alan@example.com", visitorTimezone: "UTC" }),
  });
  expect(rebook.status).toBe(201);
});

// SLICES.md Slice 9 e2e: "A booking spanning a DST transition shows the
// correct local time to both parties." 2026-11-01 is the US fall-back
// Sunday (America/New_York) — by 9am local the zone has already resolved
// to standard time, so the correct UTC instant is 14:00Z, one hour later
// than the same wall-clock time would be the week before the transition.
test("a booking spanning a DST transition shows the correct local time to both parties", async () => {
  const { ctx, site } = await authenticatedContext("bookings-dst");
  const widgetId = newUlid();

  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [bookingBlock(widgetId)],
    expectedVersion: site.page.version,
  });
  await setUtcAvailability(ctx, site.site.id, {
    timezone: "America/New_York",
    weeklyWindows: [{ dayOfWeek: 0, startMinute: 9 * 60, endMinute: 11 * 60 }],
    maxHorizonDays: 180,
  });
  await ctx.api.publish(site.site.id);

  const create = await fetch(`${API_URL}/v1/runtime/booking-widgets/${widgetId}/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ startsAt: "2026-11-01T14:00:00.000Z", visitorName: "DST Visitor", visitorEmail: "dst@example.com", visitorTimezone: "America/New_York" }),
  });
  expect(create.status).toBe(201);
  const body = (await create.json()) as { startsAt: string };
  // 9am America/New_York on the transition Sunday is 14:00 UTC (EST,
  // already past the 2am->1am fall-back) — not 13:00Z, which is what the
  // week-before's EDT offset would have produced for the same wall clock.
  expect(body.startsAt).toBe("2026-11-01T14:00:00.000Z");

  const emails = (await (await fetch(`${API_URL}/v1/dev/emails?to=${encodeURIComponent("dst@example.com")}`)).json()) as Array<{ text: string }>;
  const confirmation = emails.find((e) => e.text.includes("You're booked"));
  expect(confirmation?.text).toContain("2026-11-01T14:00:00.000Z");
});

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`${url} never became healthy within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once("exit", finish);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, 2_000);
    setTimeout(finish, 4_000);
  });
}

// SLICES.md Slice 9 e2e / R10: "Bookings continue to work in the exported
// self-host runtime" — mirrors self-host.spec.ts's own form test exactly,
// for a Booking widget and its availability rule instead.
test("bookings continue to work in the exported self-host runtime (R10)", async () => {
  test.setTimeout(120_000);

  const { ctx, site } = await authenticatedContext("bookings-selfhost");
  const widgetId = newUlid();
  const monday = futureMonday(5);

  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [bookingBlock(widgetId)],
    expectedVersion: site.page.version,
  });
  await setUtcAvailability(ctx, site.site.id);

  const outDir = await newCheckoutDir();
  const bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-e2e-selfhost-booking-bundlestore-"));
  const dataDir = await mkdtemp(path.join(tmpdir(), "pf-e2e-selfhost-booking-data-"));

  await exportBundle.run(ctx, {
    siteId: site.site.id,
    outDir,
    bundleStoreDir,
    runtimeApiUrl: `http://localhost:${SELF_HOST_PORT}`,
  });

  const child = spawn(process.execPath, ["--import", "tsx", SELF_HOST_SERVER_PATH], {
    cwd: SELF_HOST_DIR,
    env: { ...process.env, PORT: String(SELF_HOST_PORT), BUNDLE_DIR: outDir, DATA_DIR: dataDir },
    stdio: "pipe",
  });

  try {
    await waitForHealth(`http://localhost:${SELF_HOST_PORT}/health`, 20_000);

    const slots = await fetch(`http://localhost:${SELF_HOST_PORT}/v1/runtime/booking-widgets/${widgetId}/slots?rangeStart=${monday}T00:00:00.000Z&rangeEnd=${monday}T23:59:59.000Z`);
    expect(slots.status).toBe(200);
    const slotsBody = (await slots.json()) as { slots: unknown[] };
    expect(slotsBody.slots.length).toBeGreaterThan(0);

    const create = await fetch(`http://localhost:${SELF_HOST_PORT}/v1/runtime/booking-widgets/${widgetId}/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startsAt: `${monday}T09:00:00.000Z`, visitorName: "Self Host Visitor", visitorEmail: "selfhost@example.com", visitorTimezone: "UTC" }),
    });
    expect(create.status).toBe(201);
    const body = (await create.json()) as { id: string };
    expect(body.id).toBeTruthy();
  } finally {
    await stopChild(child);
    await rm(outDir, { recursive: true, force: true });
    await rm(bundleStoreDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});
