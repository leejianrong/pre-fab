import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newUlid } from "@prefab/schema";
import { createPool, hashToken, runMigrations, withTenantContext } from "../src/index.js";
import { createAccount, createSite } from "../src/repositories/index.js";
import { getAvailabilityRule, upsertAvailabilityRule } from "../src/repositories/availability-rules.js";
import { getBookingWidgetPublic, upsertPublishedBookingWidget } from "../src/repositories/booking-widgets.js";
import {
  cancelBooking,
  createBooking,
  getBookingByManageToken,
  listBookings,
  listConfirmedBookingsInRange,
  rescheduleBooking,
} from "../src/repositories/bookings.js";
import { getCalendarConnection, upsertCalendarConnection } from "../src/repositories/calendar-connections.js";

const migrateUrl = process.env.MIGRATE_DATABASE_URL_TEST;
const appUrl = process.env.DATABASE_URL_TEST;

if (!migrateUrl || !appUrl) {
  throw new Error("MIGRATE_DATABASE_URL_TEST and DATABASE_URL_TEST must be set — see .env.example and scripts/db-up.sh");
}

const migratePool = createPool(migrateUrl);
const appPool = createPool(appUrl);

beforeAll(async () => {
  await runMigrations(migratePool);
});

afterAll(async () => {
  await migratePool.end();
  await appPool.end();
});

async function makeSite(prefix: string) {
  const owner = await withTenantContext(migratePool, {}, (client) =>
    createAccount(client, { id: newUlid(), email: `${prefix}-${newUlid()}@example.com` }),
  );
  const site = await withTenantContext(appPool, { accountId: owner.id }, (client) =>
    createSite(client, { id: newUlid(), slug: `${prefix}-${newUlid()}`, name: prefix, ownerId: owner.id }),
  );
  return { owner, site };
}

async function makeWidget(siteId: string) {
  const widgetId = newUlid();
  await withTenantContext(appPool, { siteId }, (client) =>
    upsertPublishedBookingWidget(client, { id: widgetId, siteId, heading: "Book a time", description: "", confirmLabel: "Confirm booking", successMessage: "Booked." }),
  );
  return widgetId;
}

describe("availability_rules (Slice 9)", () => {
  it("upsertAvailabilityRule is idempotent per site (ON CONFLICT (site_id))", async () => {
    const { site } = await makeSite("availability");
    const id = newUlid();
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertAvailabilityRule(client, {
        id,
        siteId: site.id,
        timezone: "America/New_York",
        weeklyWindows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 660 }],
        dateOverrides: [],
        slotDurationMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        minNoticeMinutes: 60,
        maxHorizonDays: 30,
      }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertAvailabilityRule(client, {
        id: newUlid(), // a different id on the second write — site_id is still what's unique
        siteId: site.id,
        timezone: "America/Los_Angeles",
        weeklyWindows: [],
        dateOverrides: [],
        slotDurationMinutes: 45,
        bufferBeforeMinutes: 5,
        bufferAfterMinutes: 5,
        minNoticeMinutes: 120,
        maxHorizonDays: 14,
      }),
    );

    const rule = await withTenantContext(appPool, { siteId: site.id }, (client) => getAvailabilityRule(client, site.id));
    expect(rule?.timezone).toBe("America/Los_Angeles");
    expect(rule?.slotDurationMinutes).toBe(45);
  });

  it("carries no public read policy — a context-free read never resolves another site's rule", async () => {
    const { site } = await makeSite("availability-secret");
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertAvailabilityRule(client, {
        id: newUlid(),
        siteId: site.id,
        timezone: "UTC",
        weeklyWindows: [],
        dateOverrides: [],
        slotDurationMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        minNoticeMinutes: 0,
        maxHorizonDays: 30,
      }),
    );
    const contextFree = await withTenantContext(appPool, {}, (client) => getAvailabilityRule(client, site.id));
    expect(contextFree).toBeNull();
  });
});

describe("booking_widgets (Slice 9)", () => {
  it("getBookingWidgetPublic resolves with no tenant context — the runtime's own resolution path", async () => {
    const { site } = await makeSite("widget-public");
    const widgetId = await makeWidget(site.id);
    const found = await withTenantContext(appPool, {}, (client) => getBookingWidgetPublic(client, widgetId));
    expect(found?.siteId).toBe(site.id);
  });
});

describe("bookings — double-booking concurrency (Slice 9, ADR-0006 applied to slot exclusivity)", () => {
  it("two concurrent inserts for the same site and start time resolve to exactly one success and one clean rejection", async () => {
    const { site } = await makeSite("bookings-race");
    const widgetId = await makeWidget(site.id);
    const startsAt = new Date("2026-06-15T14:00:00Z");
    const endsAt = new Date("2026-06-15T14:30:00Z");

    const attempt = (suffix: string) =>
      withTenantContext(appPool, { siteId: site.id }, (client) =>
        createBooking(client, {
          id: newUlid(),
          siteId: site.id,
          widgetId,
          startsAt,
          endsAt,
          visitorName: `Visitor ${suffix}`,
          visitorEmail: `visitor-${suffix}@example.com`,
          visitorTimezone: "UTC",
          notes: null,
          manageTokenHash: hashToken(`raw-token-${suffix}`),
        }),
      );

    const [a, b] = await Promise.all([attempt("a"), attempt("b")]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);

    const list = await withTenantContext(appPool, { siteId: site.id }, (client) => listBookings(client, site.id, { status: "confirmed" }));
    expect(list.total).toBe(1);
  });

  it("canceling a booking releases the slot for a new one at the same time", async () => {
    const { site } = await makeSite("bookings-release");
    const widgetId = await makeWidget(site.id);
    const startsAt = new Date("2026-06-16T14:00:00Z");
    const endsAt = new Date("2026-06-16T14:30:00Z");

    const first = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createBooking(client, {
        id: newUlid(),
        siteId: site.id,
        widgetId,
        startsAt,
        endsAt,
        visitorName: "First Visitor",
        visitorEmail: "first@example.com",
        visitorTimezone: "UTC",
        notes: null,
        manageTokenHash: hashToken("raw-first"),
      }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");

    await withTenantContext(appPool, { siteId: site.id }, (client) => cancelBooking(client, site.id, first.booking.id));

    const second = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createBooking(client, {
        id: newUlid(),
        siteId: site.id,
        widgetId,
        startsAt,
        endsAt,
        visitorName: "Second Visitor",
        visitorEmail: "second@example.com",
        visitorTimezone: "UTC",
        notes: null,
        manageTokenHash: hashToken("raw-second"),
      }),
    );
    expect(second.ok).toBe(true);
  });

  it("rescheduling onto an already-confirmed slot is rejected without moving the booking", async () => {
    const { site } = await makeSite("bookings-reschedule");
    const widgetId = await makeWidget(site.id);
    const slotA = { startsAt: new Date("2026-06-17T14:00:00Z"), endsAt: new Date("2026-06-17T14:30:00Z") };
    const slotB = { startsAt: new Date("2026-06-17T15:00:00Z"), endsAt: new Date("2026-06-17T15:30:00Z") };

    const bookingA = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createBooking(client, { id: newUlid(), siteId: site.id, widgetId, ...slotA, visitorName: "A", visitorEmail: "a@example.com", visitorTimezone: "UTC", notes: null, manageTokenHash: hashToken("a") }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createBooking(client, { id: newUlid(), siteId: site.id, widgetId, ...slotB, visitorName: "B", visitorEmail: "b@example.com", visitorTimezone: "UTC", notes: null, manageTokenHash: hashToken("b") }),
    );
    expect(bookingA.ok).toBe(true);
    if (!bookingA.ok) throw new Error("unreachable");

    const result = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      rescheduleBooking(client, { siteId: site.id, bookingId: bookingA.booking.id, startsAt: slotB.startsAt, endsAt: slotB.endsAt }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("slot_taken");

    const unchanged = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      getBookingByManageToken(client, site.id, bookingA.booking.id, hashToken("a")),
    );
    expect(unchanged?.startsAt).toEqual(slotA.startsAt);
  });
});

describe("bookings — RLS and token resolution (Slice 9, R20)", () => {
  it("carries no public read policy — a booking is invisible with no tenant context", async () => {
    const { site } = await makeSite("bookings-secret");
    const widgetId = await makeWidget(site.id);
    const created = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createBooking(client, {
        id: newUlid(),
        siteId: site.id,
        widgetId,
        startsAt: new Date("2026-07-01T10:00:00Z"),
        endsAt: new Date("2026-07-01T10:30:00Z"),
        visitorName: "Secret Visitor",
        visitorEmail: "secret@example.com",
        visitorTimezone: "UTC",
        notes: null,
        manageTokenHash: hashToken("secret-token"),
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("unreachable");

    const contextFree = await withTenantContext(appPool, {}, (client) => getBookingByManageToken(client, site.id, created.booking.id, hashToken("secret-token")));
    expect(contextFree).toBeNull();

    const crossTenant = await withTenantContext(appPool, { siteId: newUlid() }, (client) => getBookingByManageToken(client, site.id, created.booking.id, hashToken("secret-token")));
    expect(crossTenant).toBeNull();
  });

  it("getBookingByManageToken requires an exact token hash match", async () => {
    const { site } = await makeSite("bookings-token");
    const widgetId = await makeWidget(site.id);
    const created = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createBooking(client, {
        id: newUlid(),
        siteId: site.id,
        widgetId,
        startsAt: new Date("2026-07-02T10:00:00Z"),
        endsAt: new Date("2026-07-02T10:30:00Z"),
        visitorName: "Visitor",
        visitorEmail: "visitor@example.com",
        visitorTimezone: "UTC",
        notes: null,
        manageTokenHash: hashToken("correct-token"),
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("unreachable");

    const wrong = await withTenantContext(appPool, { siteId: site.id }, (client) => getBookingByManageToken(client, site.id, created.booking.id, hashToken("wrong-token")));
    expect(wrong).toBeNull();

    const right = await withTenantContext(appPool, { siteId: site.id }, (client) => getBookingByManageToken(client, site.id, created.booking.id, hashToken("correct-token")));
    expect(right?.id).toBe(created.booking.id);
  });

  it("listConfirmedBookingsInRange only returns bookings overlapping the given range, canceled ones excluded", async () => {
    const { site } = await makeSite("bookings-range");
    const widgetId = await makeWidget(site.id);
    const inRange = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createBooking(client, { id: newUlid(), siteId: site.id, widgetId, startsAt: new Date("2026-08-01T10:00:00Z"), endsAt: new Date("2026-08-01T10:30:00Z"), visitorName: "In", visitorEmail: "in@example.com", visitorTimezone: "UTC", notes: null, manageTokenHash: hashToken("in") }),
    );
    const outOfRange = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createBooking(client, { id: newUlid(), siteId: site.id, widgetId, startsAt: new Date("2026-09-01T10:00:00Z"), endsAt: new Date("2026-09-01T10:30:00Z"), visitorName: "Out", visitorEmail: "out@example.com", visitorTimezone: "UTC", notes: null, manageTokenHash: hashToken("out") }),
    );
    const canceledInRange = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createBooking(client, { id: newUlid(), siteId: site.id, widgetId, startsAt: new Date("2026-08-02T10:00:00Z"), endsAt: new Date("2026-08-02T10:30:00Z"), visitorName: "Canceled", visitorEmail: "canceled@example.com", visitorTimezone: "UTC", notes: null, manageTokenHash: hashToken("canceled") }),
    );
    if (!inRange.ok || !outOfRange.ok || !canceledInRange.ok) throw new Error("unreachable");
    await withTenantContext(appPool, { siteId: site.id }, (client) => cancelBooking(client, site.id, canceledInRange.booking.id));

    const results = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      listConfirmedBookingsInRange(client, site.id, new Date("2026-08-01T00:00:00Z"), new Date("2026-08-31T23:59:59Z")),
    );
    expect(results.map((b) => b.id)).toEqual([inRange.booking.id]);
  });
});

describe("calendar_connections (Slice 9)", () => {
  it("carries no public read policy — a context-free read never returns a token", async () => {
    const { site } = await makeSite("calendar-secret");
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertCalendarConnection(client, {
        id: newUlid(),
        siteId: site.id,
        provider: "google",
        externalCalendarId: "primary",
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      }),
    );
    const contextFree = await withTenantContext(appPool, {}, (client) => getCalendarConnection(client, site.id));
    expect(contextFree).toBeNull();

    const found = await withTenantContext(appPool, { siteId: site.id }, (client) => getCalendarConnection(client, site.id));
    expect(found?.accessToken).toBe("access-secret");
  });

  it("upsertCalendarConnection is idempotent per site (ON CONFLICT (site_id))", async () => {
    const { site } = await makeSite("calendar-upsert");
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertCalendarConnection(client, { id: newUlid(), siteId: site.id, provider: "google", externalCalendarId: "primary", accessToken: "a1", refreshToken: "r1", tokenExpiresAt: null }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertCalendarConnection(client, { id: newUlid(), siteId: site.id, provider: "microsoft", externalCalendarId: "cal2", accessToken: "a2", refreshToken: "r2", tokenExpiresAt: null }),
    );
    const found = await withTenantContext(appPool, { siteId: site.id }, (client) => getCalendarConnection(client, site.id));
    expect(found?.provider).toBe("microsoft");
    expect(found?.accessToken).toBe("a2");
  });
});
