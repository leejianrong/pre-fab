import type { PoolClient } from "pg";

export type EventSignupStatus = "confirmed" | "waitlisted";

export interface EventSignup {
  id: string;
  widgetId: string;
  siteId: string;
  values: Record<string, unknown>;
  status: EventSignupStatus;
  position: number | null;
  createdAt: Date;
}

interface RawEventSignupRow {
  id: string;
  widget_id: string;
  site_id: string;
  values: Record<string, unknown>;
  status: EventSignupStatus;
  position: number | null;
  created_at: Date;
}

function rowToSignup(row: RawEventSignupRow): EventSignup {
  return {
    id: row.id,
    widgetId: row.widget_id,
    siteId: row.site_id,
    values: row.values,
    status: row.status,
    position: row.position,
    createdAt: row.created_at,
  };
}

export type CreateEventSignupResult =
  | { status: "confirmed"; signup: EventSignup }
  | { status: "waitlisted"; signup: EventSignup; position: number }
  | { status: "full" };

export interface CreateEventSignupInput {
  id: string;
  widgetId: string;
  siteId: string;
  values: Record<string, unknown>;
  /** Denormalized from the widget at call time (its own publish-safe snapshot) — the same "runtime resolved this already" shape createBooking's rule lookup uses. */
  capacity: number | null;
  waitlistEnabled: boolean;
}

/**
 * The one write two racing visitors both attempt for the last spot on the
 * same widget. Unlike a booking's single exclusive slot (bookings.ts's own
 * partial unique index), capacity here is a *count* against a threshold —
 * there is no single row whose uniqueness a database constraint can
 * arbitrate directly. Instead this takes out `SELECT ... FOR UPDATE` on the
 * widget's own row first: every concurrent call for the same widgetId
 * serializes on that lock (the second caller blocks until the first
 * transaction commits or rolls back), so the confirmed-count read that
 * follows is never racing another writer — exactly the discipline
 * 0009_slice10_events.sql's own header comment describes. Must run inside
 * an already-open transaction (withTenantContext already provides one) —
 * a lock taken and released within a single implicit-transaction statement
 * would protect nothing.
 */
export async function createEventSignup(client: PoolClient, input: CreateEventSignupInput): Promise<CreateEventSignupResult> {
  const locked = await client.query(`SELECT id FROM event_signup_widgets WHERE id = $1 FOR UPDATE`, [input.widgetId]);
  if (locked.rows.length === 0) {
    // The widget row itself is gone (shouldn't happen — the caller already
    // resolved it moments earlier — but never assume a lock target exists).
    return { status: "full" };
  }

  const confirmedCountResult = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM event_signups WHERE widget_id = $1 AND status = 'confirmed'`,
    [input.widgetId],
  );
  const confirmedCount = Number(confirmedCountResult.rows[0]!.count);

  const hasRoom = input.capacity === null || confirmedCount < input.capacity;

  if (hasRoom) {
    const result = await client.query<RawEventSignupRow>(
      `INSERT INTO event_signups (id, widget_id, site_id, values, status) VALUES ($1, $2, $3, $4, 'confirmed') RETURNING *`,
      [input.id, input.widgetId, input.siteId, JSON.stringify(input.values)],
    );
    return { status: "confirmed", signup: rowToSignup(result.rows[0]!) };
  }

  if (!input.waitlistEnabled) {
    return { status: "full" };
  }

  const waitlistCountResult = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM event_signups WHERE widget_id = $1 AND status = 'waitlisted'`,
    [input.widgetId],
  );
  const position = Number(waitlistCountResult.rows[0]!.count) + 1;

  const result = await client.query<RawEventSignupRow>(
    `INSERT INTO event_signups (id, widget_id, site_id, values, status, position) VALUES ($1, $2, $3, $4, 'waitlisted', $5) RETURNING *`,
    [input.id, input.widgetId, input.siteId, JSON.stringify(input.values), position],
  );
  return { status: "waitlisted", signup: rowToSignup(result.rows[0]!), position };
}

export interface ListEventSignupsOptions {
  /** Clamped to [1, 200]. Default 50. */
  limit?: number;
  /** Clamped to >= 0. Default 0. */
  offset?: number;
}

export interface ListEventSignupsResult {
  signups: EventSignup[];
  total: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function listEventSignups(
  client: PoolClient,
  siteId: string,
  widgetId: string,
  options: ListEventSignupsOptions = {},
): Promise<ListEventSignupsResult> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));

  const countResult = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM event_signups WHERE site_id = $1 AND widget_id = $2`,
    [siteId, widgetId],
  );
  const rowsResult = await client.query<RawEventSignupRow>(
    `SELECT * FROM event_signups WHERE site_id = $1 AND widget_id = $2 ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
    [siteId, widgetId, limit, offset],
  );

  return { signups: rowsResult.rows.map(rowToSignup), total: Number(countResult.rows[0]!.count) };
}

/** Every sign-up for a widget, unpaginated — CSV/JSON export needs the whole set, not a page of it (mirrors listAllSubmissionsForExport). */
export async function listAllEventSignupsForExport(client: PoolClient, siteId: string, widgetId: string): Promise<EventSignup[]> {
  const result = await client.query<RawEventSignupRow>(
    `SELECT * FROM event_signups WHERE site_id = $1 AND widget_id = $2 ORDER BY created_at DESC, id DESC`,
    [siteId, widgetId],
  );
  return result.rows.map(rowToSignup);
}

export async function getEventSignup(client: PoolClient, siteId: string, signupId: string): Promise<EventSignup | null> {
  const result = await client.query<RawEventSignupRow>(`SELECT * FROM event_signups WHERE site_id = $1 AND id = $2`, [
    siteId,
    signupId,
  ]);
  return result.rows[0] ? rowToSignup(result.rows[0]) : null;
}

/** Per-record deletion for PDPA/GDPR (mirrors deleteSubmission). */
export async function deleteEventSignup(client: PoolClient, siteId: string, signupId: string): Promise<void> {
  await client.query(`DELETE FROM event_signups WHERE site_id = $1 AND id = $2`, [siteId, signupId]);
}
