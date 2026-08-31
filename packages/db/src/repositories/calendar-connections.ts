import type { PoolClient } from "pg";

export type CalendarProviderName = "google" | "microsoft";
export type CalendarConnectionStatus = "connected" | "error";

export interface CalendarConnection {
  id: string;
  siteId: string;
  provider: CalendarProviderName;
  status: CalendarConnectionStatus;
  externalCalendarId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  lastSyncError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawCalendarConnectionRow {
  id: string;
  site_id: string;
  provider: CalendarProviderName;
  status: CalendarConnectionStatus;
  external_calendar_id: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: Date | null;
  last_sync_error: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToCalendarConnection(row: RawCalendarConnectionRow): CalendarConnection {
  return {
    id: row.id,
    siteId: row.site_id,
    provider: row.provider,
    status: row.status,
    externalCalendarId: row.external_calendar_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiresAt: row.token_expires_at,
    lastSyncError: row.last_sync_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UpsertCalendarConnectionInput {
  id: string;
  siteId: string;
  provider: CalendarProviderName;
  externalCalendarId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}

/** calendar.connect (owner-authenticated mutation) — one connection per site, whole-document replace, same shape as availability.set. */
export async function upsertCalendarConnection(client: PoolClient, input: UpsertCalendarConnectionInput): Promise<CalendarConnection> {
  const result = await client.query<RawCalendarConnectionRow>(
    `INSERT INTO calendar_connections (id, site_id, provider, status, external_calendar_id, access_token, refresh_token, token_expires_at)
     VALUES ($1, $2, $3, 'connected', $4, $5, $6, $7)
     ON CONFLICT (site_id) DO UPDATE SET
       provider = EXCLUDED.provider,
       status = 'connected',
       external_calendar_id = EXCLUDED.external_calendar_id,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       last_sync_error = NULL,
       updated_at = now()
     RETURNING *`,
    [input.id, input.siteId, input.provider, input.externalCalendarId, input.accessToken, input.refreshToken, input.tokenExpiresAt],
  );
  return rowToCalendarConnection(result.rows[0]!);
}

export async function getCalendarConnection(client: PoolClient, siteId: string): Promise<CalendarConnection | null> {
  const result = await client.query<RawCalendarConnectionRow>(`SELECT * FROM calendar_connections WHERE site_id = $1`, [siteId]);
  return result.rows[0] ? rowToCalendarConnection(result.rows[0]) : null;
}

export async function deleteCalendarConnection(client: PoolClient, siteId: string): Promise<void> {
  await client.query(`DELETE FROM calendar_connections WHERE site_id = $1`, [siteId]);
}

/** Recorded when a sync/push against the provider fails (SLICES.md integration test: "the dashboard surfaces the failure") — never blocks a booking, only marks the connection so the owner sees it. */
export async function setCalendarConnectionError(client: PoolClient, siteId: string, error: string): Promise<void> {
  await client.query(`UPDATE calendar_connections SET status = 'error', last_sync_error = $1, updated_at = now() WHERE site_id = $2`, [
    error,
    siteId,
  ]);
}

export async function setCalendarConnectionOk(client: PoolClient, siteId: string): Promise<void> {
  await client.query(`UPDATE calendar_connections SET status = 'connected', last_sync_error = NULL, updated_at = now() WHERE site_id = $1`, [
    siteId,
  ]);
}

/** Persists a refreshed access token (and its new expiry) after a transparent OAuth refresh — see apps/api/src/lib/booking-adapters.ts's createPostgresCalendarSyncPort. */
export async function updateCalendarConnectionTokens(
  client: PoolClient,
  siteId: string,
  input: { accessToken: string; tokenExpiresAt: Date },
): Promise<void> {
  await client.query(`UPDATE calendar_connections SET access_token = $1, token_expires_at = $2, updated_at = now() WHERE site_id = $3`, [
    input.accessToken,
    input.tokenExpiresAt,
    siteId,
  ]);
}
