import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { validateIcs } from "@prefab/runtime";
import { buildApp } from "../src/app.js";
import { openSelfHostDb, type SelfHostDb } from "../src/db.js";
import { seedAvailabilityFromBundle, seedBookingWidgetsFromBundle } from "../src/booking-seed.js";
import type { EmailAttachment, EmailSender } from "../src/lib/email.js";

let dir: string;
let bundleDir: string;
let db: SelfHostDb;
let app: FastifyInstance;
let sentEmails: Array<{ to: string; subject: string; text: string; attachments?: EmailAttachment[] }>;
const WIDGET_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const SITE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";

// A Monday safely in the future — R10's own local slot computation clamps
// against the real wall clock exactly like apps/api's equivalent test.
const A_MONDAY = "2026-09-07";

async function seedBundle(): Promise<void> {
  bundleDir = path.join(dir, "bundle");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(path.join(bundleDir, "index.html"), "<!doctype html><title>Home</title>", "utf8");
  await writeFile(
    path.join(bundleDir, "prefab-booking-widgets.json"),
    JSON.stringify([{ id: WIDGET_ID, siteId: SITE_ID, heading: "Book a time", description: "", confirmLabel: "Confirm booking", successMessage: "Booked." }]),
    "utf8",
  );
  await writeFile(
    path.join(bundleDir, "prefab-availability.json"),
    JSON.stringify({
      siteId: SITE_ID,
      timezone: "UTC",
      weeklyWindows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
      dateOverrides: [],
      slotDurationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      minNoticeMinutes: 0,
      maxHorizonDays: 365,
    }),
    "utf8",
  );
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pf-selfhost-booking-"));
  await seedBundle();
  db = openSelfHostDb(path.join(dir, "prefab.db"));
  await seedBookingWidgetsFromBundle(db, bundleDir);
  await seedAvailabilityFromBundle(db, bundleDir);

  const emailSender: EmailSender = {
    async send(message) {
      sentEmails.push(message);
    },
  };
  app = buildApp({ bundleDir, db, emailSender, runtimeApiUrl: "http://localhost:8080", ownerEmail: "owner@example.com" });
});

beforeEach(() => {
  sentEmails = [];
});

afterAll(async () => {
  await app.close();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("apps/self-host — bookings work with no pre-fab infrastructure reachable (R10, Slice 9)", () => {
  it("seeded the widget and availability rule from the bundle", async () => {
    const widgetRow = db.prepare("SELECT heading FROM booking_widgets WHERE id = ?").get(WIDGET_ID) as { heading: string } | undefined;
    expect(widgetRow?.heading).toBe("Book a time");
    const ruleRow = db.prepare("SELECT timezone FROM availability_rules WHERE site_id = ?").get(SITE_ID) as { timezone: string } | undefined;
    expect(ruleRow?.timezone).toBe("UTC");
  });

  it("lists slots computed entirely locally, with no calendar sync offered (calendarSyncOk always true — no attempt was made)", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/runtime/booking-widgets/${WIDGET_ID}/slots?rangeStart=${A_MONDAY}T00:00:00.000Z&rangeEnd=${A_MONDAY}T23:59:59.000Z`,
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { slots: Array<{ startMs: number }>; calendarSyncOk: boolean };
    expect(body.slots).toHaveLength(16);
    expect(body.calendarSyncOk).toBe(true);
  });

  it("creates a booking, persists it in SQLite, and emails both parties a valid ICS invite", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/runtime/booking-widgets/${WIDGET_ID}/bookings`,
      payload: { startsAt: `${A_MONDAY}T09:00:00.000Z`, visitorName: "Ada Lovelace", visitorEmail: "ada@example.com", visitorTimezone: "Europe/London" },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { id: string };

    const row = db.prepare("SELECT visitor_email, status FROM bookings WHERE id = ?").get(body.id) as { visitor_email: string; status: string };
    expect(row.visitor_email).toBe("ada@example.com");
    expect(row.status).toBe("confirmed");

    expect(sentEmails).toHaveLength(2);
    for (const email of sentEmails) {
      expect(email.attachments).toHaveLength(1);
      const ics = Buffer.from(email.attachments![0]!.content, "base64").toString("utf8");
      expect(validateIcs(ics).valid).toBe(true);
    }
  });

  it("double-booking the same slot concurrently: one succeeds, one is rejected cleanly", async () => {
    const payload = { startsAt: `${A_MONDAY}T10:00:00.000Z`, visitorName: "Racer", visitorEmail: "racer@example.com", visitorTimezone: "UTC" };
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: `/v1/runtime/booking-widgets/${WIDGET_ID}/bookings`, payload }),
      app.inject({ method: "POST", url: `/v1/runtime/booking-widgets/${WIDGET_ID}/bookings`, payload }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it("cancels a booking via its manage token and releases the slot", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/v1/runtime/booking-widgets/${WIDGET_ID}/bookings`,
      payload: { startsAt: `${A_MONDAY}T11:00:00.000Z`, visitorName: "Grace Hopper", visitorEmail: "grace@example.com", visitorTimezone: "UTC" },
    });
    const { id: bookingId } = JSON.parse(create.body) as { id: string };
    const manageText = sentEmails.find((e) => e.to === "grace@example.com")!.text;
    const token = new URL(manageText.match(/https?:\/\/\S+\/manage\?token=\S+/)![0]).searchParams.get("token")!;

    const cancel = await app.inject({ method: "POST", url: `/v1/runtime/bookings/${SITE_ID}/${bookingId}/cancel`, payload: { token } });
    expect(cancel.statusCode).toBe(200);

    const row = db.prepare("SELECT status FROM bookings WHERE id = ?").get(bookingId) as { status: string };
    expect(row.status).toBe("canceled");

    const rebook = await app.inject({
      method: "POST",
      url: `/v1/runtime/booking-widgets/${WIDGET_ID}/bookings`,
      payload: { startsAt: `${A_MONDAY}T11:00:00.000Z`, visitorName: "Alan Turing", visitorEmail: "alan@example.com", visitorTimezone: "UTC" },
    });
    expect(rebook.statusCode).toBe(201);
  });
});
