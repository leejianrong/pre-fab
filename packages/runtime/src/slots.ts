import type { AvailabilityRuleManifest, BusyInterval, DateOverride, WeeklyWindow } from "./booking-types.js";
import { addDaysToDateString, dayOfWeekForDateString, zonedDateString, zonedWallTimeToUtcMs } from "./timezone.js";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Slot {
  startMs: number;
  endMs: number;
}

export interface ComputeSlotsInput {
  rule: AvailabilityRuleManifest;
  /** The window to compute over, UTC epoch ms — always additionally clamped to [now + minNotice, now + maxHorizon]. */
  rangeStartMs: number;
  rangeEndMs: number;
  /** Existing bookings and synced external-calendar busy time, already merged — buffers apply uniformly to both (SLICES.md: "rules minus existing bookings minus synced busy time"). */
  busy: BusyInterval[];
  /** Injectable for tests — never read from the ambient clock inside this function (mirrors apps/api/src/lib/subscriptions.ts's addDays discipline). */
  now?: number;
}

function windowsForDate(rule: AvailabilityRuleManifest, dateIso: string): Array<{ startMinute: number; endMinute: number }> {
  const override: DateOverride | undefined = rule.dateOverrides.find((o) => o.date === dateIso);
  if (override) {
    if (override.closed) return [];
    return override.windows;
  }
  const dow = dayOfWeekForDateString(dateIso);
  return rule.weeklyWindows.filter((w: WeeklyWindow) => w.dayOfWeek === dow).map((w) => ({ startMinute: w.startMinute, endMinute: w.endMinute }));
}

function overlapsBuffered(candidate: Slot, busy: BusyInterval, bufferBeforeMs: number, bufferAfterMs: number): boolean {
  const expandedStart = busy.startMs - bufferBeforeMs;
  const expandedEnd = busy.endMs + bufferAfterMs;
  return candidate.startMs < expandedEnd && candidate.endMs > expandedStart;
}

/**
 * The algorithmic core of Slice 9 (ADR-0009): a site's weekly recurring
 * windows and date overrides, expressed in the owner's own local wall-clock
 * time, minus existing bookings, minus synced external-calendar busy time,
 * clamped to minimum notice and maximum booking horizon. Every wall-clock
 * -> UTC conversion goes through timezone.ts's DST-correct helpers — this
 * function itself only ever compares millisecond instants, never local
 * calendar fields, so it cannot reintroduce a DST bug of its own.
 */
export function computeAvailableSlots(input: ComputeSlotsInput): Slot[] {
  const { rule, busy } = input;
  const now = input.now ?? Date.now();
  const slotMs = rule.slotDurationMinutes * MINUTE_MS;
  const bufferBeforeMs = rule.bufferBeforeMinutes * MINUTE_MS;
  const bufferAfterMs = rule.bufferAfterMinutes * MINUTE_MS;
  const earliestAllowedMs = now + rule.minNoticeMinutes * MINUTE_MS;
  const latestAllowedMs = now + rule.maxHorizonDays * DAY_MS;

  const clampedStartMs = Math.max(input.rangeStartMs, earliestAllowedMs);
  const clampedEndMs = Math.min(input.rangeEndMs, latestAllowedMs);
  if (clampedStartMs >= clampedEndMs) return [];

  const slots: Slot[] = [];

  // Walk local dates rather than UTC days: a window is authored per local
  // calendar day, and a single UTC day can span two local dates (or vice
  // versa) depending on the rule's timezone offset — iterating one day
  // wider on each side and filtering by the millisecond range afterward is
  // simpler and safer than trying to derive exact UTC day boundaries first.
  let dateIso = zonedDateString(clampedStartMs - DAY_MS, rule.timezone);
  const endDateIso = zonedDateString(clampedEndMs + DAY_MS, rule.timezone);
  let guard = 0;
  while (guard < rule.maxHorizonDays + 3) {
    guard += 1;
    for (const window of windowsForDate(rule, dateIso)) {
      const windowStartMs = zonedWallTimeToUtcMs(dateIso, window.startMinute, rule.timezone);
      const windowEndMs = zonedWallTimeToUtcMs(dateIso, window.endMinute, rule.timezone);
      for (let slotStartMs = windowStartMs; slotStartMs + slotMs <= windowEndMs; slotStartMs += slotMs) {
        const candidate: Slot = { startMs: slotStartMs, endMs: slotStartMs + slotMs };
        if (candidate.startMs < clampedStartMs || candidate.endMs > clampedEndMs) continue;
        const blocked = busy.some((b) => overlapsBuffered(candidate, b, bufferBeforeMs, bufferAfterMs));
        if (!blocked) slots.push(candidate);
      }
    }
    if (dateIso === endDateIso) break;
    dateIso = addDaysToDateString(dateIso, 1);
  }

  slots.sort((a, b) => a.startMs - b.startMs);
  return slots;
}
