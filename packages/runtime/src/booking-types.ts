/**
 * Slice 9's own vocabulary (ADR-0007/ADR-0009/ADR-0010) — deliberately
 * independent of @prefab/schema and every control-plane package, the same
 * discipline types.ts documents for forms. apps/self-host reimplements the
 * storage interfaces below against SQLite; nothing here references a
 * control-plane type even by name.
 */

export interface WeeklyWindow {
  /** 0 = Sunday .. 6 = Saturday. */
  dayOfWeek: number;
  /** Minutes since local midnight, in the rule's own timezone. */
  startMinute: number;
  endMinute: number;
}

export interface DateOverride {
  /** ISO 8601 `YYYY-MM-DD`, in the rule's own timezone. */
  date: string;
  /** True closes the whole day regardless of `windows` or any weekly window for that day. */
  closed: boolean;
  /** When not closed, replaces (never adds to) that date's weekly window(s). */
  windows: Array<{ startMinute: number; endMinute: number }>;
}

/** The runtime-readable shape of a site's one availability configuration — owner-authored via `availability.set`. */
export interface AvailabilityRuleManifest {
  id: string;
  siteId: string;
  timezone: string;
  weeklyWindows: WeeklyWindow[];
  dateOverrides: DateOverride[];
  slotDurationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxHorizonDays: number;
}

/** The publish-safe manifest a Booking block's own props are snapshotted into — see @prefab/db's `booking_widgets` table. */
export interface BookingWidgetManifest {
  id: string;
  siteId: string;
  heading: string;
  description: string;
  confirmLabel: string;
  successMessage: string;
}

export interface BookingWidgetStore {
  getWidget(widgetId: string): Promise<BookingWidgetManifest | null>;
}

export interface AvailabilityStore {
  getRule(siteId: string): Promise<AvailabilityRuleManifest | null>;
}

/** A busy interval, epoch milliseconds — existing bookings and synced calendar busy time are both expressed this way once resolved, so slot computation (slots.ts) never has to know which source a block of time came from. */
export interface BusyInterval {
  startMs: number;
  endMs: number;
  /** The booking's own id, when this interval came from an existing booking — lets a reschedule exclude its own current slot from "busy" when re-checking availability for its new slot. Absent for synced external-calendar busy time, which has no booking id to exclude by. */
  sourceId?: string;
}

export interface BookingRecord {
  id: string;
  siteId: string;
  widgetId: string;
  startsAt: string;
  endsAt: string;
  visitorName: string;
  visitorEmail: string;
  visitorTimezone: string;
  notes: string | null;
  manageToken: string;
  externalEventId: string | null;
}

export type CreateBookingStoreResult = { status: "created"; booking: BookingRecord } | { status: "slot_taken" };

export interface CreateBookingStoreInput {
  id: string;
  siteId: string;
  widgetId: string;
  startsAtMs: number;
  endsAtMs: number;
  visitorName: string;
  visitorEmail: string;
  visitorTimezone: string;
  notes: string | null;
  /** The raw, one-time secret — the store persists only a hash of it (mirrors an API token's own lifecycle). */
  manageToken: string;
}

export type RescheduleBookingStoreResult = { status: "rescheduled"; booking: BookingRecord } | { status: "slot_taken" } | { status: "not_found" };

export interface BookingStore {
  create(input: CreateBookingStoreInput): Promise<CreateBookingStoreResult>;
  /** Resolves a booking for the visitor's own cancel/reschedule link — `manageToken` is the raw secret; the store hashes it the same way it was hashed at creation before comparing. */
  getByManageToken(siteId: string, bookingId: string, manageToken: string): Promise<BookingRecord | null>;
  cancel(siteId: string, bookingId: string): Promise<BookingRecord | null>;
  reschedule(siteId: string, bookingId: string, startsAtMs: number, endsAtMs: number): Promise<RescheduleBookingStoreResult>;
  setExternalEventId(siteId: string, bookingId: string, externalEventId: string | null): Promise<void>;
  /** Every confirmed booking overlapping [rangeStartMs, rangeEndMs) — what slot computation subtracts. */
  listConfirmedInRange(siteId: string, rangeStartMs: number, rangeEndMs: number): Promise<BusyInterval[]>;
}

/**
 * Calendar sync as an optional side-channel, never a precondition:
 * `getBusyTimes` failing degrades slot computation (fewer synced busy
 * blocks, surfaced to the caller as `calendarSyncOk: false`) rather than
 * blocking it, and `pushEvent`/`updateEvent`/`cancelEvent` are always
 * best-effort, mirroring submit.ts's notifyBestEffort/webhookBestEffort —
 * a calendar failure can never turn an otherwise-successful booking back
 * into a failure (SLICES.md: "the booking page still renders, the widget
 * shows an explicit error, the dashboard surfaces the failure").
 * apps/self-host supplies a no-op implementation (single-tenant local
 * software has no OAuth callback surface to offer sync from at all) —
 * booking creation with local availability rules works unchanged either
 * way (R10).
 */
export interface CalendarSyncPort {
  /** Busy blocks already on the connected external calendar within [rangeStartMs, rangeEndMs). Returns `null` (not an empty array) when no calendar is connected, or `{ok:false}` when connected but unreachable. */
  getBusyTimes(siteId: string, rangeStartMs: number, rangeEndMs: number): Promise<{ ok: true; busy: BusyInterval[] } | { ok: false; error: string } | { ok: true; busy: null }>;
  pushEvent(siteId: string, booking: BookingRecord): Promise<{ externalEventId: string } | null>;
  updateEvent(siteId: string, booking: BookingRecord): Promise<void>;
  cancelEvent(siteId: string, booking: BookingRecord): Promise<void>;
}

/** "Both parties get a calendar invite" (SLICES.md) — `ownerEmail` is who the owner-side copy goes to, resolved by the caller (a site's account email, or null when the site somehow has none) so the runtime core never needs to know what an "account" is. */
export interface BookingNotifier {
  notifyConfirmed(input: { siteId: string; booking: BookingRecord; ownerEmail: string | null; ownerTimezone: string; manageBaseUrl: string }): Promise<void>;
  notifyCanceled(input: { siteId: string; booking: BookingRecord; ownerEmail: string | null; ownerTimezone: string }): Promise<void>;
  notifyRescheduled(input: { siteId: string; booking: BookingRecord; ownerEmail: string | null; ownerTimezone: string; manageBaseUrl: string }): Promise<void>;
}
