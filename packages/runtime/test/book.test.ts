import { describe, expect, it } from "vitest";
import { cancelBookingByToken, createBooking, rescheduleBookingByToken, type BookingDeps } from "../src/book.js";
import { createInMemoryRateLimiter } from "../src/rate-limit.js";
import type { AvailabilityRuleManifest, BookingRecord, BookingWidgetManifest, BusyInterval } from "../src/booking-types.js";

const WIDGET: BookingWidgetManifest = {
  id: "widget1",
  siteId: "site1",
  heading: "Book a time",
  description: "",
  confirmLabel: "Confirm booking",
  successMessage: "You're booked.",
};

const RULE: AvailabilityRuleManifest = {
  id: "rule1",
  siteId: "site1",
  timezone: "UTC",
  weeklyWindows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 11 * 60 }],
  dateOverrides: [],
  slotDurationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 0,
  maxHorizonDays: 365,
};

const MONDAY_SLOT_START_MS = Date.UTC(2026, 0, 5, 9, 0, 0); // a Monday, 9:00 UTC

/** An in-memory BookingStore that actually enforces the same one-slot-one-booking exclusivity the real Postgres unique index does — good enough to prove book.ts correctly turns a losing race into "slot_taken" rather than silently double-booking or throwing. */
function makeFakeDeps(overrides: Partial<BookingDeps> = {}): { deps: BookingDeps; bookings: Map<string, BookingRecord>; calendarCalls: string[]; notifyCalls: string[] } {
  const bookings = new Map<string, BookingRecord>();
  const canceled = new Set<string>();
  const takenStarts = new Set<number>();
  const calendarCalls: string[] = [];
  const notifyCalls: string[] = [];

  const deps: BookingDeps = {
    widgets: { async getWidget(id) { return id === WIDGET.id ? WIDGET : null; } },
    availability: { async getRule(siteId) { return siteId === RULE.siteId ? RULE : null; } },
    bookings: {
      async create(input) {
        if (takenStarts.has(input.startsAtMs)) return { status: "slot_taken" };
        takenStarts.add(input.startsAtMs);
        const record: BookingRecord = {
          id: input.id,
          siteId: input.siteId,
          widgetId: input.widgetId,
          startsAt: new Date(input.startsAtMs).toISOString(),
          endsAt: new Date(input.endsAtMs).toISOString(),
          visitorName: input.visitorName,
          visitorEmail: input.visitorEmail,
          visitorTimezone: input.visitorTimezone,
          notes: input.notes,
          manageToken: input.manageToken,
          externalEventId: null,
        };
        bookings.set(record.id, record);
        return { status: "created", booking: record };
      },
      async getByManageToken(siteId, bookingId, manageToken) {
        const record = bookings.get(bookingId);
        if (!record || record.siteId !== siteId || record.manageToken !== manageToken) return null;
        return record;
      },
      async cancel(siteId, bookingId) {
        const record = bookings.get(bookingId);
        if (!record || record.siteId !== siteId || canceled.has(bookingId)) return null;
        takenStarts.delete(new Date(record.startsAt).getTime());
        canceled.add(bookingId);
        return record;
      },
      async reschedule(siteId, bookingId, startsAtMs, endsAtMs) {
        const record = bookings.get(bookingId);
        if (!record || record.siteId !== siteId) return { status: "not_found" };
        if (takenStarts.has(startsAtMs)) return { status: "slot_taken" };
        takenStarts.delete(new Date(record.startsAt).getTime());
        takenStarts.add(startsAtMs);
        const updated = { ...record, startsAt: new Date(startsAtMs).toISOString(), endsAt: new Date(endsAtMs).toISOString() };
        bookings.set(bookingId, updated);
        return { status: "rescheduled", booking: updated };
      },
      async setExternalEventId(_siteId, bookingId, externalEventId) {
        const record = bookings.get(bookingId);
        if (record) bookings.set(bookingId, { ...record, externalEventId });
      },
      async listConfirmedInRange(_siteId, rangeStartMs, rangeEndMs): Promise<BusyInterval[]> {
        return [...bookings.values()]
          .filter((b) => !canceled.has(b.id))
          .filter((b) => {
            const start = new Date(b.startsAt).getTime();
            const end = new Date(b.endsAt).getTime();
            return start < rangeEndMs && end > rangeStartMs;
          })
          .map((b) => ({ startMs: new Date(b.startsAt).getTime(), endMs: new Date(b.endsAt).getTime(), sourceId: b.id }));
      },
    },
    calendarSync: {
      async getBusyTimes() {
        calendarCalls.push("getBusyTimes");
        return { ok: true, busy: null };
      },
      async pushEvent(_siteId, booking) {
        calendarCalls.push("pushEvent");
        return { externalEventId: `ext-${booking.id}` };
      },
      async updateEvent() {
        calendarCalls.push("updateEvent");
      },
      async cancelEvent() {
        calendarCalls.push("cancelEvent");
      },
    },
    notifier: {
      async notifyConfirmed() { notifyCalls.push("confirmed"); },
      async notifyCanceled() { notifyCalls.push("canceled"); },
      async notifyRescheduled() { notifyCalls.push("rescheduled"); },
    },
    rateLimiter: createInMemoryRateLimiter({ limit: 100, windowMs: 60_000 }),
    ...overrides,
  };

  return { deps, bookings, calendarCalls, notifyCalls };
}

const VALID_INPUT = {
  id: "booking1",
  widgetId: WIDGET.id,
  startsAtMs: MONDAY_SLOT_START_MS,
  visitorName: "Ada Lovelace",
  visitorEmail: "ada@example.com",
  visitorTimezone: "Europe/London",
  manageToken: "raw-token-1",
  manageBaseUrl: "https://example.com",
  ownerEmail: "owner@example.com",
  now: Date.UTC(2026, 0, 1),
};

describe("createBooking", () => {
  it("creates a booking for a currently-offered slot, pushing a calendar event and notifying best-effort", async () => {
    const { deps, calendarCalls, notifyCalls } = makeFakeDeps();
    const result = await createBooking(VALID_INPUT, deps);
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("unreachable");
    expect(result.booking.id).toBe("booking1");
    expect(result.calendarSyncOk).toBe(true);
    expect(calendarCalls).toContain("pushEvent");
    expect(notifyCalls).toEqual(["confirmed"]);
  });

  it("returns widget_not_found for an unknown widget", async () => {
    const { deps } = makeFakeDeps();
    const result = await createBooking({ ...VALID_INPUT, widgetId: "nope" }, deps);
    expect(result.status).toBe("widget_not_found");
  });

  it("returns slot_taken when the requested time is not currently offered (outside any window)", async () => {
    const { deps } = makeFakeDeps();
    const result = await createBooking({ ...VALID_INPUT, startsAtMs: Date.UTC(2026, 0, 5, 3, 0, 0) }, deps);
    expect(result.status).toBe("slot_taken");
  });

  it("returns invalid for a malformed visitor email, storing nothing", async () => {
    const { deps, bookings } = makeFakeDeps();
    const result = await createBooking({ ...VALID_INPUT, visitorEmail: "not-an-email" }, deps);
    expect(result.status).toBe("invalid");
    expect(bookings.size).toBe(0);
  });

  it("double-booking the same slot concurrently: one succeeds, one is rejected cleanly", async () => {
    const { deps } = makeFakeDeps();
    const [first, second] = await Promise.all([
      createBooking({ ...VALID_INPUT, id: "race-a", manageToken: "token-a" }, deps),
      createBooking({ ...VALID_INPUT, id: "race-b", manageToken: "token-b" }, deps),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["created", "slot_taken"]);
  });

  it("degrades gracefully when calendar sync is unreachable — the booking still succeeds", async () => {
    const { deps } = makeFakeDeps({
      calendarSync: {
        async getBusyTimes() { return { ok: false, error: "provider unreachable" }; },
        async pushEvent() { throw new Error("provider unreachable"); },
        async updateEvent() {},
        async cancelEvent() {},
      },
    });
    const result = await createBooking(VALID_INPUT, deps);
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("unreachable");
    expect(result.calendarSyncOk).toBe(false);
  });

  it("does not fail the booking when notification throws", async () => {
    const { deps, bookings } = makeFakeDeps({ notifier: { async notifyConfirmed() { throw new Error("email down"); }, async notifyCanceled() {}, async notifyRescheduled() {} } });
    const result = await createBooking(VALID_INPUT, deps);
    expect(result.status).toBe("created");
    expect(bookings.size).toBe(1);
  });
});

describe("cancelBookingByToken", () => {
  it("cancels a booking with a matching token and releases the slot for rebooking", async () => {
    const { deps } = makeFakeDeps();
    await createBooking(VALID_INPUT, deps);
    const result = await cancelBookingByToken({ siteId: "site1", bookingId: "booking1", manageToken: "raw-token-1", ownerEmail: "owner@example.com", ownerTimezone: "UTC" }, deps);
    expect(result.status).toBe("canceled");

    const rebooked = await createBooking({ ...VALID_INPUT, id: "booking2", manageToken: "raw-token-2" }, deps);
    expect(rebooked.status).toBe("created");
  });

  it("returns not_found for a wrong token", async () => {
    const { deps } = makeFakeDeps();
    await createBooking(VALID_INPUT, deps);
    const result = await cancelBookingByToken({ siteId: "site1", bookingId: "booking1", manageToken: "wrong-token", ownerEmail: "owner@example.com", ownerTimezone: "UTC" }, deps);
    expect(result.status).toBe("not_found");
  });
});

describe("rescheduleBookingByToken", () => {
  it("moves a booking to a new, currently-offered slot", async () => {
    const { deps } = makeFakeDeps();
    await createBooking(VALID_INPUT, deps);
    const newStart = MONDAY_SLOT_START_MS + 30 * 60_000;
    const result = await rescheduleBookingByToken(
      { siteId: "site1", bookingId: "booking1", manageToken: "raw-token-1", newStartsAtMs: newStart, ownerEmail: "owner@example.com", ownerTimezone: "UTC", manageBaseUrl: "https://example.com", now: Date.UTC(2026, 0, 1) },
      deps,
    );
    expect(result.status).toBe("rescheduled");
    if (result.status !== "rescheduled") throw new Error("unreachable");
    expect(result.booking.startsAt).toBe(new Date(newStart).toISOString());
  });

  it("rejects a reschedule onto a slot already taken by a different booking", async () => {
    const { deps } = makeFakeDeps();
    await createBooking(VALID_INPUT, deps);
    const otherStart = MONDAY_SLOT_START_MS + 30 * 60_000;
    await createBooking({ ...VALID_INPUT, id: "booking2", manageToken: "raw-token-2", startsAtMs: otherStart }, deps);

    const result = await rescheduleBookingByToken(
      { siteId: "site1", bookingId: "booking1", manageToken: "raw-token-1", newStartsAtMs: otherStart, ownerEmail: "owner@example.com", ownerTimezone: "UTC", manageBaseUrl: "https://example.com", now: Date.UTC(2026, 0, 1) },
      deps,
    );
    expect(result.status).toBe("slot_taken");
  });
});
