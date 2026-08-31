import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SelfHostDb } from "./db.js";

interface PublishSafeBookingWidgetManifest {
  id: string;
  siteId: string;
  heading: string;
  description: string;
  confirmLabel: string;
  successMessage: string;
}

interface PublishableAvailabilityRule {
  siteId: string;
  timezone: string;
  weeklyWindows: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>;
  dateOverrides: Array<{ date: string; closed: boolean; windows: Array<{ startMinute: number; endMinute: number }> }>;
  slotDurationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxHorizonDays: number;
}

/** Mirrors forms-seed.ts's seedFormsFromBundle exactly — this instance's whole "publish" step for Booking blocks, idempotent (upsert) across restarts and re-exports. */
export async function seedBookingWidgetsFromBundle(db: SelfHostDb, bundleDir: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(path.join(bundleDir, "prefab-booking-widgets.json"), "utf8");
  } catch {
    return 0;
  }
  const widgets: PublishSafeBookingWidgetManifest[] = JSON.parse(raw);

  const upsert = db.prepare(
    `INSERT INTO booking_widgets (id, site_id, heading, description, confirm_label, success_message)
     VALUES (@id, @siteId, @heading, @description, @confirmLabel, @successMessage)
     ON CONFLICT (id) DO UPDATE SET
       site_id = excluded.site_id,
       heading = excluded.heading,
       description = excluded.description,
       confirm_label = excluded.confirm_label,
       success_message = excluded.success_message`,
  );
  for (const widget of widgets) upsert.run(widget);
  return widgets.length;
}

/**
 * Seeds `availability_rules` from `prefab-availability.json` — a self-
 * hosted instance has no `availability.set` mutation of its own to call
 * (no control plane, R10's whole point), so this bundle-carried snapshot
 * (the site's rule as of its last hosted publish) is what makes local slot
 * computation work immediately, with no separate operator setup required.
 * An operator can still hand-edit the `availability_rules` row afterward
 * (same "operator edits this file/row directly" pattern schema.sql already
 * documents for form_settings) — this seed only ever runs once per site_id
 * via ON CONFLICT DO NOTHING on the *fields*, so it never clobbers a
 * deliberate local edit on a later restart against a re-exported bundle.
 */
export async function seedAvailabilityFromBundle(db: SelfHostDb, bundleDir: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(path.join(bundleDir, "prefab-availability.json"), "utf8");
  } catch {
    return false;
  }
  const rule: PublishableAvailabilityRule | null = JSON.parse(raw);
  if (!rule) return false;

  db.prepare(
    `INSERT INTO availability_rules (site_id, timezone, weekly_windows, date_overrides, slot_duration_minutes, buffer_before_minutes, buffer_after_minutes, min_notice_minutes, max_horizon_days)
     VALUES (@siteId, @timezone, @weeklyWindows, @dateOverrides, @slotDurationMinutes, @bufferBeforeMinutes, @bufferAfterMinutes, @minNoticeMinutes, @maxHorizonDays)
     ON CONFLICT (site_id) DO NOTHING`,
  ).run({
    siteId: rule.siteId,
    timezone: rule.timezone,
    weeklyWindows: JSON.stringify(rule.weeklyWindows),
    dateOverrides: JSON.stringify(rule.dateOverrides),
    slotDurationMinutes: rule.slotDurationMinutes,
    bufferBeforeMinutes: rule.bufferBeforeMinutes,
    bufferAfterMinutes: rule.bufferAfterMinutes,
    minNoticeMinutes: rule.minNoticeMinutes,
    maxHorizonDays: rule.maxHorizonDays,
  });
  return true;
}
