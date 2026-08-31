import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { newUlid, type PageDocument } from "@prefab/schema";
import { BOOKING_BLOCK_TYPE, bookingDefaultProps } from "@prefab/blocks";
import { withTenantContext, runMigrations, createAccount } from "@prefab/db";
import { validateIcs } from "@prefab/runtime";
import { FakeCalendarProvider } from "../src/lib/calendar-provider.js";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import type { EmailAttachment, EmailSender } from "../src/lib/email.js";

const { Pool } = pg;

const migrateUrl = process.env.MIGRATE_DATABASE_URL_TEST;
const appUrl = process.env.DATABASE_URL_TEST;
if (!migrateUrl || !appUrl) {
  throw new Error("MIGRATE_DATABASE_URL_TEST and DATABASE_URL_TEST must be set — see .env.example");
}

const migratePool = new Pool({ connectionString: migrateUrl });
const appPool = new Pool({ connectionString: appUrl });

let bundleStoreDir: string;
let assetStoreDir: string;
let app: FastifyInstance;
let calendarProvider: FakeCalendarProvider;
let sentEmails: Array<{ to: string; subject: string; text: string; attachments?: EmailAttachment[] }>;
const TEST_PLATFORM_HOST = "prefab-bookings.test";

beforeAll(async () => {
  await runMigrations(migratePool);
  await migratePool.query(
    "TRUNCATE bookings, booking_widgets, availability_rules, calendar_connections, custom_domains, assets, publishes, blocks, pages, themes, sites, api_tokens, sessions, accounts CASCADE",
  );
  bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bookings-bundles-"));
  assetStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bookings-assets-"));

  calendarProvider = new FakeCalendarProvider();
  const bookingEmailSender: EmailSender = {
    async send(message) {
      sentEmails.push(message);
    },
  };

  app = buildApp({
    pool: appPool,
    bundleStoreDir,
    assetStoreDir,
    platformHost: TEST_PLATFORM_HOST,
    calendarProviders: { google: calendarProvider, microsoft: calendarProvider },
    bookingEmailSender,
  });
  await app.ready();
});

beforeEach(() => {
  sentEmails = [];
});

afterAll(async () => {
  await app.close();
  await migratePool.end();
  await appPool.end();
  if (bundleStoreDir) await rm(bundleStoreDir, { recursive: true, force: true });
  if (assetStoreDir) await rm(assetStoreDir, { recursive: true, force: true });
});

async function seedAccountAndLogin(email: string) {
  await withTenantContext(migratePool, {}, (client) => createAccount(client, { id: newUlid(), email }));
  const login = await app.inject({ method: "POST", url: "/v1/dev/login", payload: { email } });
  const cookieHeader = login.headers["set-cookie"];
  const cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  return cookie!.split(";")[0]!;
}

/** UTC. A Monday safely in the future (minNoticeMinutes/maxHorizonDays clamp against the real wall clock) and clear of any DST transition, so slot-boundary math in this file is easy to reason about by hand. */
const A_MONDAY = "2026-09-07"; // 2026-09-07 is a Monday
const WEEKDAY_9_TO_5 = [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 }]; // Monday only, keeps fixtures small

async function setUtcAvailability(cookie: string, siteId: string, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "PUT",
    url: `/v1/sites/${siteId}/availability`,
    headers: { cookie },
    payload: {
      timezone: "UTC",
      weeklyWindows: WEEKDAY_9_TO_5,
      dateOverrides: [],
      slotDurationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      minNoticeMinutes: 0,
      maxHorizonDays: 365,
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(200);
}

async function createPublishedBookingSite(cookie: string): Promise<{ siteId: string; widgetId: string }> {
  const created = await app.inject({ method: "POST", url: "/v1/sites", headers: { cookie }, payload: { slug: `booking-site-${newUlid()}`, name: "Booking Site" } });
  const { site, page } = created.json() as { site: { id: string }; page: PageDocument };
  const widgetId = newUlid();

  const write = await app.inject({
    method: "PUT",
    url: `/v1/sites/${site.id}/pages/${page.id}`,
    headers: { cookie },
    payload: {
      title: page.title,
      slug: page.slug,
      blocks: [{ id: widgetId, type: BOOKING_BLOCK_TYPE, parent: null, order: 1000, schemaVersion: 1, props: bookingDefaultProps }],
      expectedVersion: page.version,
    },
  });
  expect(write.statusCode).toBe(200);

  const publish = await app.inject({ method: "POST", url: `/v1/sites/${site.id}/publish`, headers: { cookie } });
  expect(publish.statusCode).toBe(200);

  return { siteId: site.id, widgetId };
}

function firstSlotStartIso(): string {
  return `${A_MONDAY}T09:00:00.000Z`;
}

describe("the runtime API — booking (Slice 9, ADR-0009)", () => {
  it("lists slots, creates a booking, and both parties are notified with a valid ICS invite", async () => {
    const cookie = await seedAccountAndLogin(`bookings-happy-${newUlid()}@example.com`);
    const { siteId, widgetId } = await createPublishedBookingSite(cookie);
    await setUtcAvailability(cookie, siteId);
    // The owner's Google Calendar shows it (SLICES.md demo) — only meaningful once a calendar is actually connected.
    const connect = await app.inject({ method: "POST", url: `/v1/sites/${siteId}/calendar`, headers: { cookie }, payload: { provider: "google" } });
    expect(connect.statusCode).toBe(200);

    const slots = await app.inject({
      method: "GET",
      url: `/v1/runtime/booking-widgets/${widgetId}/slots?rangeStart=${A_MONDAY}T00:00:00.000Z&rangeEnd=${A_MONDAY}T23:59:59.000Z`,
    });
    expect(slots.statusCode).toBe(200);
    const slotsBody = slots.json() as { slots: Array<{ startMs: number; endMs: number }>; calendarSyncOk: boolean };
    expect(slotsBody.slots.length).toBe(16); // 9am-5pm / 30min
    expect(slotsBody.calendarSyncOk).toBe(true);

    const create = await app.inject({
      method: "POST",
      url: `/v1/runtime/booking-widgets/${widgetId}/bookings`,
      payload: { startsAt: firstSlotStartIso(), visitorName: "Ada Lovelace", visitorEmail: "ada@example.com", visitorTimezone: "Europe/London", notes: "Looking forward to it" },
    });
    expect(create.statusCode).toBe(201);
    const booking = create.json() as { id: string; startsAt: string };

    // Both parties get a calendar invite (SLICES.md demo) — the visitor
    // always, and the owner because seedAccountAndLogin's account is the
    // site's own owner.
    expect(sentEmails).toHaveLength(2);
    const visitorEmail = sentEmails.find((e) => e.to === "ada@example.com");
    const ownerEmail = sentEmails.find((e) => e.to !== "ada@example.com");
    expect(visitorEmail).toBeTruthy();
    expect(ownerEmail).toBeTruthy();
    for (const email of [visitorEmail!, ownerEmail!]) {
      expect(email.attachments).toHaveLength(1);
      const ics = Buffer.from(email.attachments![0]!.content, "base64").toString("utf8");
      expect(validateIcs(ics).valid).toBe(true);
      expect(ics).toContain("METHOD:REQUEST");
    }

    // The owner's calendar reflects it (SLICES.md demo) — pushed to the fake provider.
    const list = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/bookings`, headers: { cookie } });
    const listBody = list.json() as { bookings: Array<{ id: string; externalEventId: string | null }> };
    expect(listBody.bookings[0]?.id).toBe(booking.id);
    expect(listBody.bookings[0]?.externalEventId).toBeTruthy();
  });

  it("double-booking the same slot concurrently: one succeeds, one is rejected cleanly", async () => {
    const cookie = await seedAccountAndLogin(`bookings-race-${newUlid()}@example.com`);
    const { siteId, widgetId } = await createPublishedBookingSite(cookie);
    await setUtcAvailability(cookie, siteId);

    const payload = { startsAt: firstSlotStartIso(), visitorName: "Racer", visitorEmail: "racer@example.com", visitorTimezone: "UTC" };
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: `/v1/runtime/booking-widgets/${widgetId}/bookings`, payload }),
      app.inject({ method: "POST", url: `/v1/runtime/booking-widgets/${widgetId}/bookings`, payload }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it("cancelling releases the slot and updates the external calendar", async () => {
    const cookie = await seedAccountAndLogin(`bookings-cancel-${newUlid()}@example.com`);
    const { siteId, widgetId } = await createPublishedBookingSite(cookie);
    await setUtcAvailability(cookie, siteId);

    const create = await app.inject({
      method: "POST",
      url: `/v1/runtime/booking-widgets/${widgetId}/bookings`,
      payload: { startsAt: firstSlotStartIso(), visitorName: "Grace Hopper", visitorEmail: "grace@example.com", visitorTimezone: "UTC" },
    });
    const bookingId = (create.json() as { id: string }).id;

    const cancel = await app.inject({ method: "POST", url: `/v1/sites/${siteId}/bookings/${bookingId}/cancel`, headers: { cookie } });
    expect(cancel.statusCode).toBe(200);

    // The visitor gets a cancellation notice too (both parties, again).
    expect(sentEmails.some((e) => e.to === "grace@example.com" && e.subject.includes("canceled"))).toBe(true);

    const rebook = await app.inject({
      method: "POST",
      url: `/v1/runtime/booking-widgets/${widgetId}/bookings`,
      payload: { startsAt: firstSlotStartIso(), visitorName: "Alan Turing", visitorEmail: "alan@example.com", visitorTimezone: "UTC" },
    });
    expect(rebook.statusCode).toBe(201);
  });

  it("a visitor can cancel and reschedule their own booking via their manage token, with no principal", async () => {
    const cookie = await seedAccountAndLogin(`bookings-manage-${newUlid()}@example.com`);
    const { siteId, widgetId } = await createPublishedBookingSite(cookie);
    await setUtcAvailability(cookie, siteId);

    const create = await app.inject({
      method: "POST",
      url: `/v1/runtime/booking-widgets/${widgetId}/bookings`,
      payload: { startsAt: firstSlotStartIso(), visitorName: "Visitor", visitorEmail: "visitor@example.com", visitorTimezone: "UTC" },
    });
    const { id: bookingId } = create.json() as { id: string };
    const manageEmailText = sentEmails.find((e) => e.to === "visitor@example.com")!.text;
    const manageUrlMatch = manageEmailText.match(/https?:\/\/\S+\/manage\?token=\S+/);
    expect(manageUrlMatch).toBeTruthy();
    const token = new URL(manageUrlMatch![0]).searchParams.get("token")!;

    // Reschedule to the next slot (9:30) via the token, no cookie/principal at all.
    const newStart = `${A_MONDAY}T09:30:00.000Z`;
    const reschedule = await app.inject({
      method: "POST",
      url: `/v1/runtime/bookings/${siteId}/${bookingId}/reschedule`,
      payload: { token, startsAt: newStart },
    });
    expect(reschedule.statusCode).toBe(200);
    expect((reschedule.json() as { startsAt: string }).startsAt).toBe(newStart);

    // Wrong token is rejected.
    const badCancel = await app.inject({ method: "POST", url: `/v1/runtime/bookings/${siteId}/${bookingId}/cancel`, payload: { token: "wrong" } });
    expect(badCancel.statusCode).toBe(404);

    const cancel = await app.inject({ method: "POST", url: `/v1/runtime/bookings/${siteId}/${bookingId}/cancel`, payload: { token } });
    expect(cancel.statusCode).toBe(200);
  });

  it("degrades gracefully when the calendar provider is unavailable: booking still succeeds, calendarSyncOk is false, and the connection status surfaces the failure", async () => {
    const cookie = await seedAccountAndLogin(`bookings-degrade-${newUlid()}@example.com`);
    const { siteId, widgetId } = await createPublishedBookingSite(cookie);
    await setUtcAvailability(cookie, siteId);

    const connect = await app.inject({ method: "POST", url: `/v1/sites/${siteId}/calendar`, headers: { cookie }, payload: { provider: "google" } });
    expect(connect.statusCode).toBe(200);
    const { externalCalendarId } = connect.json() as { externalCalendarId: string };
    calendarProvider.setUnavailable(externalCalendarId, true);

    const slots = await app.inject({
      method: "GET",
      url: `/v1/runtime/booking-widgets/${widgetId}/slots?rangeStart=${A_MONDAY}T00:00:00.000Z&rangeEnd=${A_MONDAY}T23:59:59.000Z`,
    });
    expect((slots.json() as { calendarSyncOk: boolean }).calendarSyncOk).toBe(false);
    // The page/widget still renders real slots — never a hard failure.
    expect((slots.json() as { slots: unknown[] }).slots.length).toBeGreaterThan(0);

    const create = await app.inject({
      method: "POST",
      url: `/v1/runtime/booking-widgets/${widgetId}/bookings`,
      payload: { startsAt: firstSlotStartIso(), visitorName: "Visitor", visitorEmail: "visitor2@example.com", visitorTimezone: "UTC" },
    });
    expect(create.statusCode).toBe(201);
    expect((create.json() as { calendarSyncOk: boolean }).calendarSyncOk).toBe(false);

    const status = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/calendar`, headers: { cookie } });
    const statusBody = status.json() as { status: string; lastSyncError: string | null };
    expect(statusBody.status).toBe("error");
    expect(statusBody.lastSyncError).toBeTruthy();

    calendarProvider.setUnavailable(externalCalendarId, false);
  });

  it("respects synced busy time from the connected calendar", async () => {
    const cookie = await seedAccountAndLogin(`bookings-synced-busy-${newUlid()}@example.com`);
    const { siteId, widgetId } = await createPublishedBookingSite(cookie);
    await setUtcAvailability(cookie, siteId);

    const connect = await app.inject({ method: "POST", url: `/v1/sites/${siteId}/calendar`, headers: { cookie }, payload: { provider: "google" } });
    const { externalCalendarId } = connect.json() as { externalCalendarId: string };
    calendarProvider.setBusyTimes(externalCalendarId, [{ startMs: Date.parse(firstSlotStartIso()), endMs: Date.parse(firstSlotStartIso()) + 30 * 60_000 }]);

    const create = await app.inject({
      method: "POST",
      url: `/v1/runtime/booking-widgets/${widgetId}/bookings`,
      payload: { startsAt: firstSlotStartIso(), visitorName: "Visitor", visitorEmail: "busy@example.com", visitorTimezone: "UTC" },
    });
    expect(create.statusCode).toBe(409);
  });
});

describe("availability.set / availability.get (Slice 9)", () => {
  it("round-trips a full availability configuration", async () => {
    const cookie = await seedAccountAndLogin(`availability-${newUlid()}@example.com`);
    const { siteId } = await createPublishedBookingSite(cookie);
    await setUtcAvailability(cookie, siteId, { bufferBeforeMinutes: 10, bufferAfterMinutes: 15, minNoticeMinutes: 120, maxHorizonDays: 45 });

    const get = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/availability`, headers: { cookie } });
    const body = get.json() as { bufferBeforeMinutes: number; bufferAfterMinutes: number; minNoticeMinutes: number; maxHorizonDays: number };
    expect(body.bufferBeforeMinutes).toBe(10);
    expect(body.bufferAfterMinutes).toBe(15);
    expect(body.minNoticeMinutes).toBe(120);
    expect(body.maxHorizonDays).toBe(45);
  });
});
