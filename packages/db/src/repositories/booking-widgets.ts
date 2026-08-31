import type { PoolClient } from "pg";

/** The publish-safe manifest a Booking block's props are snapshotted into on every publish — mirrors @prefab/db's forms.ts exactly, see 0008_slice9.sql's header comment for why. */
export interface BookingWidget {
  id: string;
  siteId: string;
  heading: string;
  description: string;
  confirmLabel: string;
  successMessage: string;
  createdAt: Date;
  updatedAt: Date;
}

interface RawBookingWidgetRow {
  id: string;
  site_id: string;
  heading: string;
  description: string;
  confirm_label: string;
  success_message: string;
  created_at: Date;
  updated_at: Date;
}

function rowToBookingWidget(row: RawBookingWidgetRow): BookingWidget {
  return {
    id: row.id,
    siteId: row.site_id,
    heading: row.heading,
    description: row.description,
    confirmLabel: row.confirm_label,
    successMessage: row.success_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Called by the publish pipeline for every Booking block on every published page — mirrors upsertPublishedForm exactly. */
export async function upsertPublishedBookingWidget(
  client: PoolClient,
  input: { id: string; siteId: string; heading: string; description: string; confirmLabel: string; successMessage: string },
): Promise<BookingWidget> {
  const result = await client.query<RawBookingWidgetRow>(
    `INSERT INTO booking_widgets (id, site_id, heading, description, confirm_label, success_message)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       heading = EXCLUDED.heading,
       description = EXCLUDED.description,
       confirm_label = EXCLUDED.confirm_label,
       success_message = EXCLUDED.success_message,
       updated_at = now()
     RETURNING *`,
    [input.id, input.siteId, input.heading, input.description, input.confirmLabel, input.successMessage],
  );
  return rowToBookingWidget(result.rows[0]!);
}

/** The runtime's only way to resolve a widgetId with no tenant context — relies entirely on `booking_widgets_public_read`. Call with `withTenantContext(pool, {})`. */
export async function getBookingWidgetPublic(client: PoolClient, widgetId: string): Promise<BookingWidget | null> {
  const result = await client.query<RawBookingWidgetRow>(`SELECT * FROM booking_widgets WHERE id = $1`, [widgetId]);
  return result.rows[0] ? rowToBookingWidget(result.rows[0]) : null;
}

export async function getBookingWidget(client: PoolClient, siteId: string, widgetId: string): Promise<BookingWidget | null> {
  const result = await client.query<RawBookingWidgetRow>(`SELECT * FROM booking_widgets WHERE site_id = $1 AND id = $2`, [
    siteId,
    widgetId,
  ]);
  return result.rows[0] ? rowToBookingWidget(result.rows[0]) : null;
}
