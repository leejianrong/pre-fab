import { createHash } from "node:crypto";
import type {
  AvailabilityStore,
  BookingStore,
  BookingWidgetStore,
  BusyInterval,
  CalendarSyncPort,
} from "@prefab/runtime";
import type { SelfHostDb } from "./db.js";

/** Identical to @prefab/db's hashToken (deliberately duplicated — this package must never import the control plane, ADR-0010): a manage token is never persisted in plaintext, self-hosted or not. */
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function createSqliteBookingWidgetStore(db: SelfHostDb): BookingWidgetStore {
  return {
    async getWidget(widgetId) {
      const row = db
        .prepare<[string], { id: string; site_id: string; heading: string; description: string; confirm_label: string; success_message: string }>(
          "SELECT id, site_id, heading, description, confirm_label, success_message FROM booking_widgets WHERE id = ?",
        )
        .get(widgetId);
      if (!row) return null;
      return { id: row.id, siteId: row.site_id, heading: row.heading, description: row.description, confirmLabel: row.confirm_label, successMessage: row.success_message };
    },
  };
}

interface AvailabilityRow {
  timezone: string;
  weekly_windows: string;
  date_overrides: string;
  slot_duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  min_notice_minutes: number;
  max_horizon_days: number;
}

export function createSqliteAvailabilityStore(db: SelfHostDb): AvailabilityStore {
  return {
    async getRule(siteId) {
      const row = db.prepare<[string], AvailabilityRow>("SELECT * FROM availability_rules WHERE site_id = ?").get(siteId);
      if (!row) return null;
      return {
        id: siteId,
        siteId,
        timezone: row.timezone,
        weeklyWindows: JSON.parse(row.weekly_windows),
        dateOverrides: JSON.parse(row.date_overrides),
        slotDurationMinutes: row.slot_duration_minutes,
        bufferBeforeMinutes: row.buffer_before_minutes,
        bufferAfterMinutes: row.buffer_after_minutes,
        minNoticeMinutes: row.min_notice_minutes,
        maxHorizonDays: row.max_horizon_days,
      };
    },
  };
}

interface BookingRow {
  id: string;
  site_id: string;
  widget_id: string;
  starts_at: string;
  ends_at: string;
  visitor_name: string;
  visitor_email: string;
  visitor_timezone: string;
  notes: string | null;
  status: "confirmed" | "canceled";
  manage_token_hash: string;
  external_event_id: string | null;
}

const UNIQUE_CONSTRAINT_MESSAGE = /UNIQUE constraint failed/i;

export function createSqliteBookingStore(db: SelfHostDb): BookingStore {
  function toRecord(row: BookingRow, manageToken: string) {
    return {
      id: row.id,
      siteId: row.site_id,
      widgetId: row.widget_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      visitorName: row.visitor_name,
      visitorEmail: row.visitor_email,
      visitorTimezone: row.visitor_timezone,
      notes: row.notes,
      manageToken,
      externalEventId: row.external_event_id,
    };
  }

  return {
    async create(input) {
      const createdAt = new Date().toISOString();
      try {
        db.prepare(
          `INSERT INTO bookings (id, site_id, widget_id, starts_at, ends_at, visitor_name, visitor_email, visitor_timezone, notes, manage_token_hash, created_at)
           VALUES (@id, @siteId, @widgetId, @startsAt, @endsAt, @visitorName, @visitorEmail, @visitorTimezone, @notes, @manageTokenHash, @createdAt)`,
        ).run({
          id: input.id,
          siteId: input.siteId,
          widgetId: input.widgetId,
          startsAt: new Date(input.startsAtMs).toISOString(),
          endsAt: new Date(input.endsAtMs).toISOString(),
          visitorName: input.visitorName,
          visitorEmail: input.visitorEmail,
          visitorTimezone: input.visitorTimezone,
          notes: input.notes,
          manageTokenHash: hashToken(input.manageToken),
          createdAt,
        });
      } catch (error) {
        if (error instanceof Error && UNIQUE_CONSTRAINT_MESSAGE.test(error.message)) return { status: "slot_taken" as const };
        throw error;
      }
      const row = db.prepare<[string], BookingRow>("SELECT * FROM bookings WHERE id = ?").get(input.id)!;
      return { status: "created" as const, booking: toRecord(row, input.manageToken) };
    },

    async getByManageToken(siteId, bookingId, manageToken) {
      const row = db
        .prepare<[string, string, string], BookingRow>("SELECT * FROM bookings WHERE site_id = ? AND id = ? AND manage_token_hash = ?")
        .get(siteId, bookingId, hashToken(manageToken));
      return row ? toRecord(row, manageToken) : null;
    },

    async cancel(siteId, bookingId) {
      const row = db.prepare<[string, string], BookingRow>("SELECT * FROM bookings WHERE site_id = ? AND id = ? AND status = 'confirmed'").get(siteId, bookingId);
      if (!row) return null;
      db.prepare("UPDATE bookings SET status = 'canceled', canceled_at = ? WHERE id = ?").run(new Date().toISOString(), bookingId);
      return toRecord(row, "");
    },

    async reschedule(siteId, bookingId, startsAtMs, endsAtMs) {
      const existing = db.prepare<[string, string], BookingRow>("SELECT * FROM bookings WHERE site_id = ? AND id = ? AND status = 'confirmed'").get(siteId, bookingId);
      if (!existing) return { status: "not_found" as const };
      try {
        db.prepare("UPDATE bookings SET starts_at = ?, ends_at = ? WHERE id = ?").run(new Date(startsAtMs).toISOString(), new Date(endsAtMs).toISOString(), bookingId);
      } catch (error) {
        if (error instanceof Error && UNIQUE_CONSTRAINT_MESSAGE.test(error.message)) return { status: "slot_taken" as const };
        throw error;
      }
      const row = db.prepare<[string], BookingRow>("SELECT * FROM bookings WHERE id = ?").get(bookingId)!;
      return { status: "rescheduled" as const, booking: toRecord(row, "") };
    },

    async setExternalEventId(_siteId, bookingId, externalEventId) {
      db.prepare("UPDATE bookings SET external_event_id = ? WHERE id = ?").run(externalEventId, bookingId);
    },

    async listConfirmedInRange(siteId, rangeStartMs, rangeEndMs): Promise<BusyInterval[]> {
      const rows = db
        .prepare<[string, string, string], BookingRow>(
          "SELECT * FROM bookings WHERE site_id = ? AND status = 'confirmed' AND starts_at < ? AND ends_at > ?",
        )
        .all(siteId, new Date(rangeEndMs).toISOString(), new Date(rangeStartMs).toISOString());
      return rows.map((r) => ({ startMs: new Date(r.starts_at).getTime(), endMs: new Date(r.ends_at).getTime(), sourceId: r.id }));
    },
  };
}

/**
 * A self-hosted instance offers no two-way calendar sync (no OAuth
 * callback surface to run one from, in this milestone) — `getBusyTimes`
 * reports "no calendar connected" (never degraded: there was never an
 * attempt to sync), and push/update/cancel are no-ops. Local availability
 * rules and bookings work completely unaffected (R10) — this is the
 * concrete form of that separation.
 */
export function createNullCalendarSyncPort(): CalendarSyncPort {
  return {
    async getBusyTimes() {
      return { ok: true, busy: null };
    },
    async pushEvent() {
      return null;
    },
    async updateEvent() {},
    async cancelEvent() {},
  };
}
