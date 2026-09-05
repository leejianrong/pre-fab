import type { EventSignupStore, EventSignupWidgetStore } from "@prefab/runtime";
import type { SelfHostDb } from "./db.js";

/**
 * SQLite-backed halves of @prefab/runtime's KAN-1138 storage interfaces
 * (ADR-0010) — the exact same interfaces apps/api/src/lib/event-signup-adapters.ts
 * implements against Postgres. `signUpForEvent` runs completely unchanged
 * against these; only what's behind the interface differs.
 *
 * Capacity concurrency needs no `SELECT ... FOR UPDATE`-equivalent here at
 * all, unlike the Postgres adapter: better-sqlite3's API is synchronous, so
 * the whole read-count-then-insert sequence below runs to completion within
 * one turn of the event loop with no `await` in between — nothing else in
 * this single process can interleave a second sign-up's read in the middle
 * of it. This is the same reason self-host's booking-adapters.ts needs no
 * lock for its own unique-index-guarded insert.
 */
export function createSqliteEventSignupWidgetStore(db: SelfHostDb): EventSignupWidgetStore {
  return {
    async getWidget(widgetId) {
      const row = db
        .prepare<[string], { id: string; site_id: string; heading: string; fields: string; capacity: number | null; waitlist_enabled: number; submit_label: string }>(
          "SELECT id, site_id, heading, fields, capacity, waitlist_enabled, submit_label FROM event_signup_widgets WHERE id = ?",
        )
        .get(widgetId);
      if (!row) return null;
      return {
        id: row.id,
        siteId: row.site_id,
        heading: row.heading,
        fields: JSON.parse(row.fields),
        capacity: row.capacity,
        waitlistEnabled: row.waitlist_enabled === 1,
        submitLabel: row.submit_label,
      };
    },
  };
}

interface EventSignupRow {
  id: string;
  widget_id: string;
  site_id: string;
  values_json: string;
  status: "confirmed" | "waitlisted";
  position: number | null;
  created_at: string;
}

function toRecord(row: EventSignupRow) {
  return {
    id: row.id,
    widgetId: row.widget_id,
    siteId: row.site_id,
    values: JSON.parse(row.values_json),
    status: row.status,
    position: row.position,
    createdAt: row.created_at,
  };
}

export function createSqliteEventSignupStore(db: SelfHostDb): EventSignupStore {
  return {
    async create(input) {
      const createdAt = new Date().toISOString();

      const confirmedCount = (
        db.prepare<[string], { count: number }>("SELECT COUNT(*) AS count FROM event_signups WHERE widget_id = ? AND status = 'confirmed'").get(input.widgetId)
      )?.count ?? 0;
      const hasRoom = input.capacity === null || confirmedCount < input.capacity;

      if (hasRoom) {
        db.prepare(
          `INSERT INTO event_signups (id, widget_id, site_id, values_json, status, created_at) VALUES (?, ?, ?, ?, 'confirmed', ?)`,
        ).run(input.id, input.widgetId, input.siteId, JSON.stringify(input.values), createdAt);
        const row = db.prepare<[string], EventSignupRow>("SELECT * FROM event_signups WHERE id = ?").get(input.id)!;
        return { status: "confirmed" as const, signup: toRecord(row) };
      }

      if (!input.waitlistEnabled) {
        return { status: "full" as const };
      }

      const waitlistCount = (
        db.prepare<[string], { count: number }>("SELECT COUNT(*) AS count FROM event_signups WHERE widget_id = ? AND status = 'waitlisted'").get(input.widgetId)
      )?.count ?? 0;
      const position = waitlistCount + 1;

      db.prepare(
        `INSERT INTO event_signups (id, widget_id, site_id, values_json, status, position, created_at) VALUES (?, ?, ?, ?, 'waitlisted', ?, ?)`,
      ).run(input.id, input.widgetId, input.siteId, JSON.stringify(input.values), position, createdAt);
      const row = db.prepare<[string], EventSignupRow>("SELECT * FROM event_signups WHERE id = ?").get(input.id)!;
      return { status: "waitlisted" as const, signup: toRecord(row), position };
    },
  };
}
