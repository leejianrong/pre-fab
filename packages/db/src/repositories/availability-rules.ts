import type { PoolClient } from "pg";

export interface WeeklyWindowRow {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface DateOverrideRow {
  date: string;
  closed: boolean;
  windows: Array<{ startMinute: number; endMinute: number }>;
}

export interface AvailabilityRule {
  id: string;
  siteId: string;
  timezone: string;
  weeklyWindows: WeeklyWindowRow[];
  dateOverrides: DateOverrideRow[];
  slotDurationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxHorizonDays: number;
  createdAt: Date;
  updatedAt: Date;
}

interface RawAvailabilityRuleRow {
  id: string;
  site_id: string;
  timezone: string;
  weekly_windows: WeeklyWindowRow[];
  date_overrides: DateOverrideRow[];
  slot_duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  min_notice_minutes: number;
  max_horizon_days: number;
  created_at: Date;
  updated_at: Date;
}

function rowToAvailabilityRule(row: RawAvailabilityRuleRow): AvailabilityRule {
  return {
    id: row.id,
    siteId: row.site_id,
    timezone: row.timezone,
    weeklyWindows: row.weekly_windows,
    dateOverrides: row.date_overrides,
    slotDurationMinutes: row.slot_duration_minutes,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    minNoticeMinutes: row.min_notice_minutes,
    maxHorizonDays: row.max_horizon_days,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SetAvailabilityRuleInput {
  id: string;
  siteId: string;
  timezone: string;
  weeklyWindows: WeeklyWindowRow[];
  dateOverrides: DateOverrideRow[];
  slotDurationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxHorizonDays: number;
}

/** availability.set (owner-authenticated mutation) — one row per site, whole-document replace (there is no partial-patch shape worth having for a handful of scalar fields plus two small arrays). */
export async function upsertAvailabilityRule(client: PoolClient, input: SetAvailabilityRuleInput): Promise<AvailabilityRule> {
  const result = await client.query<RawAvailabilityRuleRow>(
    `INSERT INTO availability_rules (id, site_id, timezone, weekly_windows, date_overrides, slot_duration_minutes, buffer_before_minutes, buffer_after_minutes, min_notice_minutes, max_horizon_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (site_id) DO UPDATE SET
       timezone = EXCLUDED.timezone,
       weekly_windows = EXCLUDED.weekly_windows,
       date_overrides = EXCLUDED.date_overrides,
       slot_duration_minutes = EXCLUDED.slot_duration_minutes,
       buffer_before_minutes = EXCLUDED.buffer_before_minutes,
       buffer_after_minutes = EXCLUDED.buffer_after_minutes,
       min_notice_minutes = EXCLUDED.min_notice_minutes,
       max_horizon_days = EXCLUDED.max_horizon_days,
       updated_at = now()
     RETURNING *`,
    [
      input.id,
      input.siteId,
      input.timezone,
      JSON.stringify(input.weeklyWindows),
      JSON.stringify(input.dateOverrides),
      input.slotDurationMinutes,
      input.bufferBeforeMinutes,
      input.bufferAfterMinutes,
      input.minNoticeMinutes,
      input.maxHorizonDays,
    ],
  );
  return rowToAvailabilityRule(result.rows[0]!);
}

export async function getAvailabilityRule(client: PoolClient, siteId: string): Promise<AvailabilityRule | null> {
  const result = await client.query<RawAvailabilityRuleRow>(`SELECT * FROM availability_rules WHERE site_id = $1`, [siteId]);
  return result.rows[0] ? rowToAvailabilityRule(result.rows[0]) : null;
}
