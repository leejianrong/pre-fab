import type { PoolClient } from "pg";

export interface EventSignupFieldRow {
  type: "text" | "email" | "textarea" | "select" | "checkbox" | "file";
  label: string;
  name: string;
  required: boolean;
  options?: string;
}

/** The publish-safe manifest an EventSignup block's props are snapshotted into on every publish — mirrors @prefab/db's forms.ts (FormManifest) exactly, see 0009_slice10_events.sql's own header comment. */
export interface EventSignupWidget {
  id: string;
  siteId: string;
  heading: string;
  fields: EventSignupFieldRow[];
  capacity: number | null;
  waitlistEnabled: boolean;
  submitLabel: string;
  createdAt: Date;
  updatedAt: Date;
}

interface RawEventSignupWidgetRow {
  id: string;
  site_id: string;
  heading: string;
  fields: EventSignupFieldRow[];
  capacity: number | null;
  waitlist_enabled: boolean;
  submit_label: string;
  created_at: Date;
  updated_at: Date;
}

function rowToWidget(row: RawEventSignupWidgetRow): EventSignupWidget {
  return {
    id: row.id,
    siteId: row.site_id,
    heading: row.heading,
    fields: row.fields,
    capacity: row.capacity,
    waitlistEnabled: row.waitlist_enabled,
    submitLabel: row.submit_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Called by the publish pipeline for every EventSignup block on every published page — mirrors upsertPublishedForm/upsertPublishedBookingWidget exactly. */
export async function upsertPublishedEventSignupWidget(
  client: PoolClient,
  input: {
    id: string;
    siteId: string;
    heading: string;
    fields: EventSignupFieldRow[];
    capacity: number | null;
    waitlistEnabled: boolean;
    submitLabel: string;
  },
): Promise<EventSignupWidget> {
  const result = await client.query<RawEventSignupWidgetRow>(
    `INSERT INTO event_signup_widgets (id, site_id, heading, fields, capacity, waitlist_enabled, submit_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       heading = EXCLUDED.heading,
       fields = EXCLUDED.fields,
       capacity = EXCLUDED.capacity,
       waitlist_enabled = EXCLUDED.waitlist_enabled,
       submit_label = EXCLUDED.submit_label,
       updated_at = now()
     RETURNING *`,
    [input.id, input.siteId, input.heading, JSON.stringify(input.fields), input.capacity, input.waitlistEnabled, input.submitLabel],
  );
  return rowToWidget(result.rows[0]!);
}

/**
 * The runtime sign-up endpoint's only way to resolve a widgetId: no tenant
 * context is set (a visitor has none), relying entirely on
 * `event_signup_widgets_public_read`'s unconditional SELECT policy — safe
 * because every column on `event_signup_widgets` is already publish-safe by
 * construction. Call with `withTenantContext(pool, {})`.
 */
export async function getEventSignupWidgetPublic(client: PoolClient, widgetId: string): Promise<EventSignupWidget | null> {
  const result = await client.query<RawEventSignupWidgetRow>(`SELECT * FROM event_signup_widgets WHERE id = $1`, [widgetId]);
  return result.rows[0] ? rowToWidget(result.rows[0]) : null;
}

export async function getEventSignupWidget(client: PoolClient, siteId: string, widgetId: string): Promise<EventSignupWidget | null> {
  const result = await client.query<RawEventSignupWidgetRow>(`SELECT * FROM event_signup_widgets WHERE site_id = $1 AND id = $2`, [
    siteId,
    widgetId,
  ]);
  return result.rows[0] ? rowToWidget(result.rows[0]) : null;
}
