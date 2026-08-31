import { describe, expect, it } from "vitest";
import { computeAvailableSlots } from "../src/slots.js";
import type { AvailabilityRuleManifest } from "../src/booking-types.js";

const BASE_RULE: AvailabilityRuleManifest = {
  id: "rule1",
  siteId: "site1",
  timezone: "America/New_York",
  weeklyWindows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 11 * 60 }], // Monday 9am-11am
  dateOverrides: [],
  slotDurationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 0,
  maxHorizonDays: 60,
};

// 2026-01-05 is a Monday.
const MONDAY_START_UTC = Date.UTC(2026, 0, 5, 0, 0, 0);
const RANGE_END_UTC = Date.UTC(2026, 0, 12, 0, 0, 0); // one week later

function slotsFor(rule: AvailabilityRuleManifest, busy: Array<{ startMs: number; endMs: number; sourceId?: string }> = [], now = Date.UTC(2025, 11, 1)) {
  return computeAvailableSlots({ rule, rangeStartMs: MONDAY_START_UTC, rangeEndMs: RANGE_END_UTC, busy, now });
}

describe("computeAvailableSlots — weekly windows", () => {
  it("produces one slot per duration increment across the window, in UTC", () => {
    const slots = slotsFor(BASE_RULE);
    // Monday 9-11am EST (UTC-5) = 14:00-16:00 UTC, 30-minute slots = 4 slots.
    expect(slots).toHaveLength(4);
    expect(slots[0]).toEqual({ startMs: Date.UTC(2026, 0, 5, 14, 0, 0), endMs: Date.UTC(2026, 0, 5, 14, 30, 0) });
    expect(slots[3]).toEqual({ startMs: Date.UTC(2026, 0, 5, 15, 30, 0), endMs: Date.UTC(2026, 0, 5, 16, 0, 0) });
  });

  it("produces no slots for a day with no matching weekly window", () => {
    const tuesdayOnly: AvailabilityRuleManifest = { ...BASE_RULE, weeklyWindows: [{ dayOfWeek: 2, startMinute: 540, endMinute: 660 }] };
    const slots = slotsFor(tuesdayOnly);
    expect(slots.every((s) => new Date(s.startMs).getUTCDay() !== 1)).toBe(true);
  });
});

describe("computeAvailableSlots — date overrides", () => {
  it("a closed override removes every slot on that date even though the weekly window would otherwise apply", () => {
    const rule: AvailabilityRuleManifest = { ...BASE_RULE, dateOverrides: [{ date: "2026-01-05", closed: true, windows: [] }] };
    const slots = slotsFor(rule);
    expect(slots.some((s) => new Date(s.startMs).toISOString().startsWith("2026-01-05"))).toBe(false);
    // The following Monday (no override) still offers its normal slots.
    expect(slots.some((s) => new Date(s.startMs).toISOString().startsWith("2026-01-12"))).toBe(false); // out of range (exclusive end)
  });

  it("a non-closed override replaces, rather than adds to, that date's weekly window", () => {
    const rule: AvailabilityRuleManifest = {
      ...BASE_RULE,
      dateOverrides: [{ date: "2026-01-05", closed: false, windows: [{ startMinute: 13 * 60, endMinute: 14 * 60 }] }],
    };
    const slots = slotsFor(rule);
    const mondaySlots = slots.filter((s) => new Date(s.startMs).toISOString().startsWith("2026-01-05"));
    expect(mondaySlots).toHaveLength(2); // 1pm-2pm / 30min = 2 slots
    expect(mondaySlots[0]!.startMs).toBe(Date.UTC(2026, 0, 5, 18, 0, 0)); // 1pm EST = 18:00 UTC
  });
});

describe("computeAvailableSlots — existing bookings and buffers", () => {
  it("removes a slot that exactly overlaps an existing booking", () => {
    const firstSlotStart = Date.UTC(2026, 0, 5, 14, 0, 0);
    const busy = [{ startMs: firstSlotStart, endMs: firstSlotStart + 30 * 60_000 }];
    const slots = slotsFor(BASE_RULE, busy);
    expect(slots).toHaveLength(3);
    expect(slots.some((s) => s.startMs === firstSlotStart)).toBe(false);
  });

  it("a buffer blocks slots adjacent to a booking, not just the booking's own slot", () => {
    const rule: AvailabilityRuleManifest = { ...BASE_RULE, bufferBeforeMinutes: 30, bufferAfterMinutes: 30 };
    // Book the second slot (14:30-15:00 UTC) — with a 30-minute buffer on
    // each side, both its neighbours (14:00-14:30 and 15:00-15:30) become
    // unavailable too, leaving only the last slot (15:30-16:00).
    const busy = [{ startMs: Date.UTC(2026, 0, 5, 14, 30, 0), endMs: Date.UTC(2026, 0, 5, 15, 0, 0) }];
    const slots = slotsFor(rule, busy);
    const mondaySlots = slots.filter((s) => new Date(s.startMs).toISOString().startsWith("2026-01-05"));
    expect(mondaySlots).toEqual([{ startMs: Date.UTC(2026, 0, 5, 15, 30, 0), endMs: Date.UTC(2026, 0, 5, 16, 0, 0) }]);
  });
});

describe("computeAvailableSlots — minimum notice and maximum horizon", () => {
  it("excludes a slot that starts before now + minNoticeMinutes", () => {
    const rule: AvailabilityRuleManifest = { ...BASE_RULE, minNoticeMinutes: 24 * 60 };
    // "now" is right at the first slot's start — a full day's notice pushes past the whole Monday window.
    const now = Date.UTC(2026, 0, 5, 14, 0, 0);
    const slots = computeAvailableSlots({ rule, rangeStartMs: MONDAY_START_UTC, rangeEndMs: RANGE_END_UTC, busy: [], now });
    expect(slots.some((s) => new Date(s.startMs).toISOString().startsWith("2026-01-05"))).toBe(false);
  });

  it("excludes a slot that starts after now + maxHorizonDays", () => {
    const rule: AvailabilityRuleManifest = { ...BASE_RULE, maxHorizonDays: 3 };
    const now = Date.UTC(2026, 0, 1);
    const slots = computeAvailableSlots({ rule, rangeStartMs: MONDAY_START_UTC, rangeEndMs: RANGE_END_UTC, busy: [], now });
    expect(slots).toHaveLength(0); // Monday Jan 5 is 4 days after Jan 1, beyond a 3-day horizon
  });

  it("includes a slot exactly at the notice/horizon boundary", () => {
    const rule: AvailabilityRuleManifest = { ...BASE_RULE, minNoticeMinutes: 0, maxHorizonDays: 60 };
    const slots = computeAvailableSlots({ rule, rangeStartMs: MONDAY_START_UTC, rangeEndMs: RANGE_END_UTC, busy: [], now: Date.UTC(2026, 0, 5, 14, 0, 0) });
    expect(slots.some((s) => s.startMs === Date.UTC(2026, 0, 5, 14, 0, 0))).toBe(true);
  });
});

describe("computeAvailableSlots — DST boundaries in both directions", () => {
  const mondayRule: AvailabilityRuleManifest = { ...BASE_RULE, minNoticeMinutes: 0, maxHorizonDays: 365 };

  it("shifts UTC slot times by exactly one hour across a spring-forward transition", () => {
    // 2026-03-02 and 2026-03-09 are both Mondays; the US transition falls
    // on Sunday 2026-03-08, so the second Monday is entirely past it.
    const rangeStart = Date.UTC(2026, 1, 23); // a Monday, comfortably before
    const rangeEnd = Date.UTC(2026, 2, 16);
    const slots = computeAvailableSlots({ rule: mondayRule, rangeStartMs: rangeStart, rangeEndMs: rangeEnd, busy: [], now: Date.UTC(2026, 0, 1) });

    const beforeTransition = slots.find((s) => new Date(s.startMs).toISOString().startsWith("2026-03-02"));
    const afterTransition = slots.find((s) => new Date(s.startMs).toISOString().startsWith("2026-03-09"));
    expect(beforeTransition!.startMs).toBe(Date.UTC(2026, 2, 2, 14, 0, 0)); // 9am EST = 14:00 UTC
    expect(afterTransition!.startMs).toBe(Date.UTC(2026, 2, 9, 13, 0, 0)); // 9am EDT = 13:00 UTC
  });

  it("shifts UTC slot times by exactly one hour across a fall-back transition", () => {
    // 2026-10-26 and 2026-11-02 are both Mondays; the US transition falls
    // on Sunday 2026-11-01.
    const rangeStart = Date.UTC(2026, 9, 19);
    const rangeEnd = Date.UTC(2026, 10, 9);
    const slots = computeAvailableSlots({ rule: mondayRule, rangeStartMs: rangeStart, rangeEndMs: rangeEnd, busy: [], now: Date.UTC(2026, 0, 1) });

    const beforeTransition = slots.find((s) => new Date(s.startMs).toISOString().startsWith("2026-10-26"));
    const afterTransition = slots.find((s) => new Date(s.startMs).toISOString().startsWith("2026-11-02"));
    expect(beforeTransition!.startMs).toBe(Date.UTC(2026, 9, 26, 13, 0, 0)); // 9am EDT = 13:00 UTC
    expect(afterTransition!.startMs).toBe(Date.UTC(2026, 10, 2, 14, 0, 0)); // 9am EST = 14:00 UTC
  });
});
