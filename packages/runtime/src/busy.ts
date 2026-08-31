import type { BookingStore, BusyInterval, CalendarSyncPort } from "./booking-types.js";

/** Wide enough to cover any realistic buffer/duration combination around a lookup window without scanning a site's whole booking history. */
export const BUSY_LOOKUP_PAD_MS = 24 * 60 * 60 * 1000;

export interface ResolvedBusy {
  busy: BusyInterval[];
  /** False when a calendar is connected but unreachable — never false just because no calendar is connected at all (that's simply "no synced busy time," not degraded). */
  calendarSyncOk: boolean;
}

/**
 * Existing bookings (always available) plus best-effort synced external-
 * calendar busy time (SLICES.md: "rules minus existing bookings minus
 * synced busy time") — shared by both the slot-listing and booking-create/
 * reschedule paths so they can never disagree about what counts as busy.
 * A calendar failure here degrades (`calendarSyncOk: false`) rather than
 * throwing — "the booking page still renders, the widget shows an explicit
 * error" (SLICES.md integration test).
 */
export async function resolveBusyTimes(
  deps: { bookings: BookingStore; calendarSync: CalendarSyncPort },
  siteId: string,
  rangeStartMs: number,
  rangeEndMs: number,
): Promise<ResolvedBusy> {
  const paddedStartMs = rangeStartMs - BUSY_LOOKUP_PAD_MS;
  const paddedEndMs = rangeEndMs + BUSY_LOOKUP_PAD_MS;

  const existing = await deps.bookings.listConfirmedInRange(siteId, paddedStartMs, paddedEndMs);

  let calendarSyncOk = true;
  let synced: BusyInterval[] = [];
  try {
    const result = await deps.calendarSync.getBusyTimes(siteId, paddedStartMs, paddedEndMs);
    if (!result.ok) calendarSyncOk = false;
    else if (result.busy) synced = result.busy;
  } catch {
    calendarSyncOk = false;
  }

  return { busy: [...existing, ...synced], calendarSyncOk };
}
