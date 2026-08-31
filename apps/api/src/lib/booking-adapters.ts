import {
  cancelBooking,
  createBooking as dbCreateBooking,
  getAvailabilityRule,
  getBookingByManageToken,
  getBookingWidgetPublic,
  getCalendarConnection,
  hashToken,
  listConfirmedBookingsInRange,
  rescheduleBooking as dbRescheduleBooking,
  setBookingExternalEventId,
  setCalendarConnectionError,
  setCalendarConnectionOk,
  updateCalendarConnectionTokens,
  withTenantContext,
  type Booking,
  type Pool,
} from "@prefab/db";
import type {
  AvailabilityStore,
  BookingRecord,
  BookingStore,
  BookingWidgetStore,
  BusyInterval,
  CalendarSyncPort,
} from "@prefab/runtime";
import type { CalendarProvider } from "./calendar-provider.js";

/**
 * The Postgres-backed halves of @prefab/runtime's Slice 9 storage
 * interfaces (ADR-0010) — apps/api is the control plane, so it's the one
 * place allowed to know these are backed by Postgres/@prefab/db and a real
 * calendar API at all. Mirrors runtime-adapters.ts (Slice 6) exactly.
 */
export function createPostgresBookingWidgetStore(pool: Pool): BookingWidgetStore {
  return {
    async getWidget(widgetId) {
      return withTenantContext(pool, {}, (client) => getBookingWidgetPublic(client, widgetId));
    },
  };
}

export function createPostgresAvailabilityStore(pool: Pool): AvailabilityStore {
  return {
    async getRule(siteId) {
      const rule = await withTenantContext(pool, { siteId }, (client) => getAvailabilityRule(client, siteId));
      if (!rule) return null;
      return {
        id: rule.id,
        siteId: rule.siteId,
        timezone: rule.timezone,
        weeklyWindows: rule.weeklyWindows,
        dateOverrides: rule.dateOverrides,
        slotDurationMinutes: rule.slotDurationMinutes,
        bufferBeforeMinutes: rule.bufferBeforeMinutes,
        bufferAfterMinutes: rule.bufferAfterMinutes,
        minNoticeMinutes: rule.minNoticeMinutes,
        maxHorizonDays: rule.maxHorizonDays,
      };
    },
  };
}

function rowToRecord(booking: Booking, manageToken: string): BookingRecord {
  return {
    id: booking.id,
    siteId: booking.siteId,
    widgetId: booking.widgetId,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    visitorName: booking.visitorName,
    visitorEmail: booking.visitorEmail,
    visitorTimezone: booking.visitorTimezone,
    notes: booking.notes,
    manageToken,
    externalEventId: booking.externalEventId,
  };
}

/**
 * `manageToken` never survives past this module: every BookingRecord
 * @prefab/runtime sees during a single call carries the raw token it was
 * just handed (create) or resolved with (getByManageToken) so notification
 * emails can build a working link, but the store itself only ever persists
 * `hashToken(manageToken)` (@prefab/db's own hash — the same one sessions
 * and API tokens use) — mirrors how a session's raw cookie value is never
 * written back to the database either.
 */
export function createPostgresBookingStore(pool: Pool): BookingStore {
  return {
    async create(input) {
      const result = await withTenantContext(pool, { siteId: input.siteId }, (client) =>
        dbCreateBooking(client, {
          id: input.id,
          siteId: input.siteId,
          widgetId: input.widgetId,
          startsAt: new Date(input.startsAtMs),
          endsAt: new Date(input.endsAtMs),
          visitorName: input.visitorName,
          visitorEmail: input.visitorEmail,
          visitorTimezone: input.visitorTimezone,
          notes: input.notes,
          manageTokenHash: hashToken(input.manageToken),
        }),
      );
      if (!result.ok) return { status: "slot_taken" };
      return { status: "created", booking: rowToRecord(result.booking, input.manageToken) };
    },
    async getByManageToken(siteId, bookingId, manageToken) {
      const booking = await withTenantContext(pool, { siteId }, (client) => getBookingByManageToken(client, siteId, bookingId, hashToken(manageToken)));
      return booking ? rowToRecord(booking, manageToken) : null;
    },
    async cancel(siteId, bookingId) {
      const booking = await withTenantContext(pool, { siteId }, (client) => cancelBooking(client, siteId, bookingId));
      // manageToken is opaque past this point (only its hash is stored) —
      // callers that reach `cancel` already resolved the booking (and its
      // raw token, if they need it) via getByManageToken beforehand.
      return booking ? rowToRecord(booking, "") : null;
    },
    async reschedule(siteId, bookingId, startsAtMs, endsAtMs) {
      const result = await withTenantContext(pool, { siteId }, (client) =>
        dbRescheduleBooking(client, { siteId, bookingId, startsAt: new Date(startsAtMs), endsAt: new Date(endsAtMs) }),
      );
      if (result.ok) return { status: "rescheduled", booking: rowToRecord(result.booking, "") };
      return result.reason === "slot_taken" ? { status: "slot_taken" } : { status: "not_found" };
    },
    async setExternalEventId(siteId, bookingId, externalEventId) {
      await withTenantContext(pool, { siteId }, (client) => setBookingExternalEventId(client, siteId, bookingId, externalEventId));
    },
    async listConfirmedInRange(siteId, rangeStartMs, rangeEndMs): Promise<BusyInterval[]> {
      const bookings = await withTenantContext(pool, { siteId }, (client) =>
        listConfirmedBookingsInRange(client, siteId, new Date(rangeStartMs), new Date(rangeEndMs)),
      );
      return bookings.map((b) => ({ startMs: b.startsAt.getTime(), endMs: b.endsAt.getTime(), sourceId: b.id }));
    },
  };
}

/**
 * Adapts a per-provider `CalendarProvider` (calendar-provider.ts) plus this
 * site's stored `calendar_connections` row into @prefab/runtime's narrow
 * CalendarSyncPort — the runtime core never learns Google/Microsoft/OAuth
 * exist, only "busy time" and "push/update/cancel an event." Token refresh
 * happens transparently here, persisting a refreshed token back to
 * `calendar_connections` before it's needed again.
 */
export function createPostgresCalendarSyncPort(pool: Pool, providers: Record<"google" | "microsoft", CalendarProvider>): CalendarSyncPort {
  async function withFreshToken<T>(siteId: string, fn: (accessToken: string, calendarId: string | null, provider: CalendarProvider) => Promise<T>): Promise<
    { ok: true; value: T } | { ok: false; error: string } | { ok: true; value: null; noConnection: true }
  > {
    const connection = await withTenantContext(pool, { siteId }, (client) => getCalendarConnection(client, siteId));
    if (!connection) return { ok: true, value: null, noConnection: true };

    const provider = providers[connection.provider];
    let accessToken = connection.accessToken ?? "";
    try {
      if (connection.refreshToken && connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() < Date.now() + 60_000) {
        const refreshed = await provider.refreshAccessToken(connection.refreshToken);
        accessToken = refreshed.accessToken;
        await withTenantContext(pool, { siteId }, (client) =>
          updateCalendarConnectionTokens(client, siteId, { accessToken: refreshed.accessToken, tokenExpiresAt: new Date(refreshed.expiresAt) }),
        );
      }
      const value = await fn(accessToken, connection.externalCalendarId, provider);
      await withTenantContext(pool, { siteId }, (client) => setCalendarConnectionOk(client, siteId));
      return { ok: true, value };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await withTenantContext(pool, { siteId }, (client) => setCalendarConnectionError(client, siteId, message));
      return { ok: false, error: message };
    }
  }

  return {
    async getBusyTimes(siteId, rangeStartMs, rangeEndMs) {
      const result = await withFreshToken(siteId, (accessToken, calendarId, provider) => provider.getBusyTimes(accessToken, calendarId, rangeStartMs, rangeEndMs));
      if ("noConnection" in result) return { ok: true, busy: null };
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, busy: result.value.map((b) => ({ startMs: b.startMs, endMs: b.endMs })) };
    },
    async pushEvent(siteId, booking) {
      const result = await withFreshToken(siteId, (accessToken, calendarId, provider) =>
        provider.createEvent(accessToken, calendarId, {
          title: `Booking with ${booking.visitorName}`,
          description: booking.notes ?? "",
          startsAtMs: new Date(booking.startsAt).getTime(),
          endsAtMs: new Date(booking.endsAt).getTime(),
          attendeeEmail: booking.visitorEmail,
          attendeeName: booking.visitorName,
        }),
      );
      if ("noConnection" in result || !result.ok) return null;
      return { externalEventId: result.value.externalEventId };
    },
    async updateEvent(siteId, booking) {
      if (!booking.externalEventId) return;
      await withFreshToken(siteId, (accessToken, calendarId, provider) =>
        provider.updateEvent(accessToken, calendarId, booking.externalEventId as string, {
          title: `Booking with ${booking.visitorName}`,
          description: booking.notes ?? "",
          startsAtMs: new Date(booking.startsAt).getTime(),
          endsAtMs: new Date(booking.endsAt).getTime(),
          attendeeEmail: booking.visitorEmail,
          attendeeName: booking.visitorName,
        }),
      );
    },
    async cancelEvent(siteId, booking) {
      if (!booking.externalEventId) return;
      await withFreshToken(siteId, (accessToken, calendarId, provider) => provider.deleteEvent(accessToken, calendarId, booking.externalEventId as string));
    },
  };
}
