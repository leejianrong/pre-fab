import { describe, expect, it } from "vitest";
import { addDaysToDateString, dayOfWeekForDateString, timeZoneOffsetMs, utcMsToZonedWallTime, zonedDateString, zonedWallTimeToUtcMs } from "../src/timezone.js";

// 2026 DST transition dates used throughout this file (verified against the
// US and EU rules): America/New_York spring-forward 2026-03-08, fall-back
// 2026-11-01 — the same dates apps/api/test/subscriptions.test.ts already
// anchors its own DST tests to. Europe/London spring-forward 2026-03-29,
// fall-back 2026-10-25.

describe("zonedWallTimeToUtcMs — DST-correct wall-clock -> UTC conversion", () => {
  it("converts a plain non-DST winter time using the standard offset", () => {
    // 9:00am America/New_York in mid-January is EST, UTC-5.
    const ms = zonedWallTimeToUtcMs("2026-01-15", 9 * 60, "America/New_York");
    expect(ms).toBe(Date.UTC(2026, 0, 15, 14, 0, 0));
  });

  it("uses the correct offset on both sides of a spring-forward transition, in the same weekly slot", () => {
    // The Sunday before the US transition: EST, UTC-5.
    const before = zonedWallTimeToUtcMs("2026-03-01", 9 * 60, "America/New_York");
    expect(before).toBe(Date.UTC(2026, 2, 1, 14, 0, 0));

    // The transition Sunday itself (clocks jump 2am -> 3am at 07:00 UTC):
    // by 9am local the zone is already in EDT, UTC-4.
    const transitionDay = zonedWallTimeToUtcMs("2026-03-08", 9 * 60, "America/New_York");
    expect(transitionDay).toBe(Date.UTC(2026, 2, 8, 13, 0, 0));

    // Same local wall-clock time, one UTC hour earlier than a naive
    // "always exactly 7 days later" assumption would predict — this is the
    // DST shift a naive fixed-offset implementation would get wrong.
    expect(transitionDay - before - 7 * 24 * 60 * 60 * 1000).toBe(-60 * 60 * 1000);
  });

  it("uses the correct offset on both sides of a fall-back transition", () => {
    // The Sunday before the US fall-back: still EDT, UTC-4.
    const before = zonedWallTimeToUtcMs("2026-10-25", 9 * 60, "America/New_York");
    expect(before).toBe(Date.UTC(2026, 9, 25, 13, 0, 0));

    // The transition Sunday (clocks fall back 2am -> 1am at 06:00 UTC): by
    // 9am local the zone is already in EST, UTC-5.
    const transitionDay = zonedWallTimeToUtcMs("2026-11-01", 9 * 60, "America/New_York");
    expect(transitionDay).toBe(Date.UTC(2026, 10, 1, 14, 0, 0));

    expect(transitionDay - before - 7 * 24 * 60 * 60 * 1000).toBe(60 * 60 * 1000);
  });

  it("is correct for a southern-hemisphere-style late-March EU transition too (opposite direction from the US)", () => {
    // Europe/London: GMT (UTC+0) before, BST (UTC+1) after 2026-03-29.
    const before = zonedWallTimeToUtcMs("2026-03-22", 9 * 60, "Europe/London");
    expect(before).toBe(Date.UTC(2026, 2, 22, 9, 0, 0));
    const after = zonedWallTimeToUtcMs("2026-03-29", 9 * 60, "Europe/London");
    expect(after).toBe(Date.UTC(2026, 2, 29, 8, 0, 0));
  });

  it("round-trips through utcMsToZonedWallTime for an ordinary time", () => {
    const ms = zonedWallTimeToUtcMs("2026-06-15", 14 * 60 + 30, "America/Los_Angeles");
    expect(utcMsToZonedWallTime(ms, "America/Los_Angeles")).toEqual({ date: "2026-06-15", minuteOfDay: 14 * 60 + 30 });
  });
});

describe("timeZoneOffsetMs", () => {
  it("reports UTC-5 for America/New_York in January and UTC-4 in July", () => {
    expect(timeZoneOffsetMs("America/New_York", Date.UTC(2026, 0, 15))).toBe(-5 * 60 * 60 * 1000);
    expect(timeZoneOffsetMs("America/New_York", Date.UTC(2026, 6, 15))).toBe(-4 * 60 * 60 * 1000);
  });

  it("reports 0 for UTC itself, always", () => {
    expect(timeZoneOffsetMs("UTC", Date.UTC(2026, 6, 15))).toBe(0);
  });
});

describe("zonedDateString", () => {
  it("can differ from the UTC calendar date near midnight west of UTC", () => {
    // 11pm on Jan 14 in Los Angeles (UTC-8) is 7am Jan 15 UTC.
    const ms = Date.UTC(2026, 0, 15, 7, 0, 0);
    expect(zonedDateString(ms, "America/Los_Angeles")).toBe("2026-01-14");
  });
});

describe("dayOfWeekForDateString", () => {
  it("matches the known 2026 US DST transition Sundays", () => {
    expect(dayOfWeekForDateString("2026-03-08")).toBe(0);
    expect(dayOfWeekForDateString("2026-11-01")).toBe(0);
  });

  it("returns 0-6 for Sunday through Saturday", () => {
    expect(dayOfWeekForDateString("2026-01-01")).toBe(4); // Thursday
  });
});

describe("addDaysToDateString", () => {
  it("crosses a month boundary", () => {
    expect(addDaysToDateString("2026-01-30", 3)).toBe("2026-02-02");
  });

  it("crosses a DST transition without being affected by it (pure date arithmetic)", () => {
    expect(addDaysToDateString("2026-03-05", 3)).toBe("2026-03-08");
  });

  it("supports negative deltas", () => {
    expect(addDaysToDateString("2026-03-01", -1)).toBe("2026-02-28");
  });
});
