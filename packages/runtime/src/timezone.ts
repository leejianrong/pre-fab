/**
 * Timezone-aware wall-clock <-> UTC conversion, with no external tz
 * dependency — Node ships full ICU by default, so `Intl.DateTimeFormat`
 * already knows every IANA zone's real offset (including DST) for any
 * instant. This is the one piece of arithmetic every other part of Slice 9
 * (availability rules, slot computation, ICS generation) is built on, and
 * it is deliberately kept pure and dependency-free so both apps/api and
 * apps/self-host get identical, testable behaviour (ADR-0010).
 *
 * DST correctness is a first-class concern here, not an edge case
 * (SLICES.md): a weekly window like "9am–5pm" is authored in the owner's
 * local wall-clock time, and must resolve to the *correct* UTC instant on
 * both sides of a DST transition, not drift by an hour the way naive
 * calendar-day or fixed-offset arithmetic would.
 */

const MINUTE_MS = 60_000;

/** The offset (in ms) `timeZone`'s local wall clock is ahead of UTC, at the instant `utcMs`. Positive east of UTC. */
export function timeZoneOffsetMs(timeZone: string, utcMs: number): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  // formatToParts can render midnight as hour "24" under hourCycle h23 in
  // some ICU builds — normalize rather than let Date.UTC roll it into the
  // next day silently mismatching what was actually asked for.
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const asIfUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return asIfUtc - utcMs;
}

/**
 * Converts a wall-clock date + minute-of-day in `timeZone` to the precise
 * UTC instant it represents. Two-pass fixed point: the first pass's offset
 * guess can land on the wrong side of a DST transition (the offset at the
 * *naive* UTC guess, not at the real instant), so a second pass re-derives
 * the offset from the corrected instant. This converges exactly for every
 * ordinary wall-clock time; a time that falls inside a spring-forward gap
 * (which never occurs during representable business hours) resolves to
 * *some* nearby instant rather than throwing, which is an acceptable
 * fallback for a value that was never a valid local time to begin with.
 */
export function zonedWallTimeToUtcMs(dateIso: string, minuteOfDay: number, timeZone: string): number {
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const naiveUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0) + minuteOfDay * MINUTE_MS;

  const firstOffset = timeZoneOffsetMs(timeZone, naiveUtcMs);
  const firstGuessMs = naiveUtcMs - firstOffset;
  const secondOffset = timeZoneOffsetMs(timeZone, firstGuessMs);
  return naiveUtcMs - secondOffset;
}

/** The inverse: given a UTC instant, the {date, minuteOfDay} wall-clock reading in `timeZone`. */
export function utcMsToZonedWallTime(utcMs: number, timeZone: string): { date: string; minuteOfDay: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, minuteOfDay: hour * 60 + Number(parts.minute) };
}

/** ISO 8601 `YYYY-MM-DD` for `utcMs`'s wall-clock date in `timeZone` — the calendar day a slot's start actually falls on locally, not in UTC. */
export function zonedDateString(utcMs: number, timeZone: string): string {
  return utcMsToZonedWallTime(utcMs, timeZone).date;
}

/** Day of week (0 = Sunday .. 6 = Saturday) for an ISO `YYYY-MM-DD` date, computed in UTC to avoid any local-timezone dependence on the machine running this code — the date string is already the wall-clock date we mean. */
export function dayOfWeekForDateString(dateIso: string): number {
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Adds `days` calendar days to an ISO `YYYY-MM-DD` date string, in UTC — pure date arithmetic, no timezone involved (mirrors apps/api/src/lib/subscriptions.ts's addDays discipline: never `Date` local-field mutation). */
export function addDaysToDateString(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day) + days * 24 * 60 * 60 * 1000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}
