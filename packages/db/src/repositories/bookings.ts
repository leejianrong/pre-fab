import type { PoolClient } from "pg";

export type BookingStatus = "confirmed" | "canceled";

export interface Booking {
  id: string;
  siteId: string;
  widgetId: string;
  startsAt: Date;
  endsAt: Date;
  visitorName: string;
  visitorEmail: string;
  visitorTimezone: string;
  notes: string | null;
  status: BookingStatus;
  manageTokenHash: string;
  externalEventId: string | null;
  createdAt: Date;
  canceledAt: Date | null;
}

interface RawBookingRow {
  id: string;
  site_id: string;
  widget_id: string;
  starts_at: Date;
  ends_at: Date;
  visitor_name: string;
  visitor_email: string;
  visitor_timezone: string;
  notes: string | null;
  status: BookingStatus;
  manage_token_hash: string;
  external_event_id: string | null;
  created_at: Date;
  canceled_at: Date | null;
}

function rowToBooking(row: RawBookingRow): Booking {
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
    status: row.status,
    manageTokenHash: row.manage_token_hash,
    externalEventId: row.external_event_id,
    createdAt: row.created_at,
    canceledAt: row.canceled_at,
  };
}

/** Postgres' unique-violation SQLSTATE — how a losing concurrent INSERT/UPDATE against `bookings_site_id_starts_at_confirmed_idx` actually surfaces (ADR-0006, applied to slot exclusivity rather than a version counter). */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

export type CreateBookingResult = { ok: true; booking: Booking } | { ok: false; reason: "slot_taken" };

export interface CreateBookingInput {
  id: string;
  siteId: string;
  widgetId: string;
  startsAt: Date;
  endsAt: Date;
  visitorName: string;
  visitorEmail: string;
  visitorTimezone: string;
  notes: string | null;
  manageTokenHash: string;
}

/**
 * The one write two racing visitors both attempt for the same slot — the
 * database's own partial unique index is the only thing that can actually
 * arbitrate that race (a version-check like writePageDocument's has nothing
 * prior to compare against on a slot's very first booking). A
 * unique-violation here is an expected, clean outcome, not an error: it
 * means the other request already won.
 */
export async function createBooking(client: PoolClient, input: CreateBookingInput): Promise<CreateBookingResult> {
  try {
    const result = await client.query<RawBookingRow>(
      `INSERT INTO bookings (id, site_id, widget_id, starts_at, ends_at, visitor_name, visitor_email, visitor_timezone, notes, manage_token_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        input.id,
        input.siteId,
        input.widgetId,
        input.startsAt.toISOString(),
        input.endsAt.toISOString(),
        input.visitorName,
        input.visitorEmail,
        input.visitorTimezone,
        input.notes,
        input.manageTokenHash,
      ],
    );
    return { ok: true, booking: rowToBooking(result.rows[0]!) };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "slot_taken" };
    throw error;
  }
}

export type RescheduleBookingResult = { ok: true; booking: Booking } | { ok: false; reason: "slot_taken" | "not_found" };

/** Moves a confirmed booking to a new slot, guarded by the same unique index createBooking relies on — a losing race here is exactly as clean. */
export async function rescheduleBooking(
  client: PoolClient,
  input: { siteId: string; bookingId: string; startsAt: Date; endsAt: Date },
): Promise<RescheduleBookingResult> {
  try {
    const result = await client.query<RawBookingRow>(
      `UPDATE bookings SET starts_at = $1, ends_at = $2 WHERE id = $3 AND site_id = $4 AND status = 'confirmed' RETURNING *`,
      [input.startsAt.toISOString(), input.endsAt.toISOString(), input.bookingId, input.siteId],
    );
    if (!result.rows[0]) return { ok: false, reason: "not_found" };
    return { ok: true, booking: rowToBooking(result.rows[0]) };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "slot_taken" };
    throw error;
  }
}

export async function cancelBooking(client: PoolClient, siteId: string, bookingId: string): Promise<Booking | null> {
  const result = await client.query<RawBookingRow>(
    `UPDATE bookings SET status = 'canceled', canceled_at = now() WHERE id = $1 AND site_id = $2 AND status = 'confirmed' RETURNING *`,
    [bookingId, siteId],
  );
  return result.rows[0] ? rowToBooking(result.rows[0]) : null;
}

export async function setBookingExternalEventId(client: PoolClient, siteId: string, bookingId: string, externalEventId: string | null): Promise<void> {
  await client.query(`UPDATE bookings SET external_event_id = $1 WHERE id = $2 AND site_id = $3`, [externalEventId, bookingId, siteId]);
}

export async function getBooking(client: PoolClient, siteId: string, bookingId: string): Promise<Booking | null> {
  const result = await client.query<RawBookingRow>(`SELECT * FROM bookings WHERE site_id = $1 AND id = $2`, [siteId, bookingId]);
  return result.rows[0] ? rowToBooking(result.rows[0]) : null;
}

/** The visitor cancel/reschedule path: siteId is already known (from the link's own URL), so this is one more `bookings_tenant_isolation`-scoped lookup, gated on the token hash matching rather than an authenticated principal. */
export async function getBookingByManageToken(
  client: PoolClient,
  siteId: string,
  bookingId: string,
  manageTokenHash: string,
): Promise<Booking | null> {
  const result = await client.query<RawBookingRow>(
    `SELECT * FROM bookings WHERE site_id = $1 AND id = $2 AND manage_token_hash = $3`,
    [siteId, bookingId, manageTokenHash],
  );
  return result.rows[0] ? rowToBooking(result.rows[0]) : null;
}

export interface ListBookingsOptions {
  /** Clamped to [1, 200]. Default 50. */
  limit?: number;
  /** Clamped to >= 0. Default 0. */
  offset?: number;
  status?: BookingStatus;
}

export interface ListBookingsResult {
  bookings: Booking[];
  total: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Owner dashboard listing — every widget on the site, newest-first (a site has one shared calendar, so there's no reason to scope this per-widget the way submissions are scoped per-form). */
export async function listBookings(client: PoolClient, siteId: string, options: ListBookingsOptions = {}): Promise<ListBookingsResult> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const statusFilter = options.status ?? null;

  const countResult = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM bookings WHERE site_id = $1 AND ($2::text IS NULL OR status = $2)`,
    [siteId, statusFilter],
  );
  const rowsResult = await client.query<RawBookingRow>(
    `SELECT * FROM bookings WHERE site_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY starts_at DESC, id DESC LIMIT $3 OFFSET $4`,
    [siteId, statusFilter, limit, offset],
  );

  return { bookings: rowsResult.rows.map(rowToBooking), total: Number(countResult.rows[0]!.count) };
}

/** Every *confirmed* booking whose window overlaps [rangeStart, rangeEnd) — exactly what slot computation subtracts from a rule's raw windows (SLICES.md: "rules minus existing bookings minus synced busy time"). */
export async function listConfirmedBookingsInRange(
  client: PoolClient,
  siteId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<Booking[]> {
  const result = await client.query<RawBookingRow>(
    `SELECT * FROM bookings WHERE site_id = $1 AND status = 'confirmed' AND starts_at < $3 AND ends_at > $2 ORDER BY starts_at ASC`,
    [siteId, rangeStart.toISOString(), rangeEnd.toISOString()],
  );
  return result.rows.map(rowToBooking);
}
