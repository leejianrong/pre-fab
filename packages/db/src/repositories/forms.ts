import type { PoolClient } from "pg";

export interface FormFieldRow {
  type: "text" | "email" | "textarea" | "select" | "checkbox" | "file";
  label: string;
  name: string;
  required: boolean;
  options?: string;
}

/** The publish-safe manifest a Form block's props are snapshotted into on every publish — see 0006_slice6.sql's header comment for why this is a separate table from `form_settings`. */
export interface FormManifest {
  id: string;
  siteId: string;
  heading: string;
  fields: FormFieldRow[];
  submitLabel: string;
  turnstileEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface RawFormRow {
  id: string;
  site_id: string;
  heading: string;
  fields: FormFieldRow[];
  submit_label: string;
  turnstile_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

function rowToForm(row: RawFormRow): FormManifest {
  return {
    id: row.id,
    siteId: row.site_id,
    heading: row.heading,
    fields: row.fields,
    submitLabel: row.submit_label,
    turnstileEnabled: row.turnstile_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Called by the publish pipeline for every Form block on every published
 * page (mirrors "publish includes only published posts" — this is the
 * runtime-readable snapshot the control plane owns). Never touches
 * `form_settings`: notify/webhook configuration is set independently via
 * `upsertFormSettings` and must survive a republish untouched.
 */
export async function upsertPublishedForm(
  client: PoolClient,
  input: { id: string; siteId: string; heading: string; fields: FormFieldRow[]; submitLabel: string; turnstileEnabled: boolean },
): Promise<FormManifest> {
  const result = await client.query<RawFormRow>(
    `INSERT INTO forms (id, site_id, heading, fields, submit_label, turnstile_enabled)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       heading = EXCLUDED.heading,
       fields = EXCLUDED.fields,
       submit_label = EXCLUDED.submit_label,
       turnstile_enabled = EXCLUDED.turnstile_enabled,
       updated_at = now()
     RETURNING *`,
    [input.id, input.siteId, input.heading, JSON.stringify(input.fields), input.submitLabel, input.turnstileEnabled],
  );
  return rowToForm(result.rows[0]!);
}

/**
 * The runtime submit endpoint's only way to resolve a formId: no tenant
 * context is set (a visitor has none), relying entirely on
 * `forms_public_read`'s unconditional SELECT policy — safe because every
 * column on `forms` is already publish-safe by construction. Call with
 * `withTenantContext(pool, {})`.
 */
export async function getFormPublic(client: PoolClient, formId: string): Promise<FormManifest | null> {
  const result = await client.query<RawFormRow>(`SELECT * FROM forms WHERE id = $1`, [formId]);
  return result.rows[0] ? rowToForm(result.rows[0]) : null;
}

export async function getForm(client: PoolClient, siteId: string, formId: string): Promise<FormManifest | null> {
  const result = await client.query<RawFormRow>(`SELECT * FROM forms WHERE site_id = $1 AND id = $2`, [siteId, formId]);
  return result.rows[0] ? rowToForm(result.rows[0]) : null;
}

export interface FormSettings {
  formId: string;
  siteId: string;
  notifyEmail: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  updatedAt: Date;
}

interface RawFormSettingsRow {
  form_id: string;
  site_id: string;
  notify_email: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  updated_at: Date;
}

function rowToFormSettings(row: RawFormSettingsRow): FormSettings {
  return {
    formId: row.form_id,
    siteId: row.site_id,
    notifyEmail: row.notify_email,
    webhookUrl: row.webhook_url,
    webhookSecret: row.webhook_secret,
    updatedAt: row.updated_at,
  };
}

/**
 * form.configure (owner-authenticated mutation). `forms` may not have a
 * row yet — a form can be configured before it is ever published — so a
 * stub row (empty heading/fields, defaulted submitLabel) is created
 * on-conflict-do-nothing first to satisfy form_settings' foreign key; the
 * next publish overwrites those fields with the real snapshot without
 * touching this table at all.
 */
export async function upsertFormSettings(
  client: PoolClient,
  input: { formId: string; siteId: string; notifyEmail: string | null; webhookUrl: string | null; webhookSecret: string | null },
): Promise<FormSettings> {
  await client.query(`INSERT INTO forms (id, site_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [input.formId, input.siteId]);
  const result = await client.query<RawFormSettingsRow>(
    `INSERT INTO form_settings (form_id, site_id, notify_email, webhook_url, webhook_secret)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (form_id) DO UPDATE SET
       notify_email = EXCLUDED.notify_email,
       webhook_url = EXCLUDED.webhook_url,
       webhook_secret = EXCLUDED.webhook_secret,
       updated_at = now()
     RETURNING *`,
    [input.formId, input.siteId, input.notifyEmail, input.webhookUrl, input.webhookSecret],
  );
  return rowToFormSettings(result.rows[0]!);
}

export async function getFormSettings(client: PoolClient, siteId: string, formId: string): Promise<FormSettings | null> {
  const result = await client.query<RawFormSettingsRow>(`SELECT * FROM form_settings WHERE site_id = $1 AND form_id = $2`, [
    siteId,
    formId,
  ]);
  return result.rows[0] ? rowToFormSettings(result.rows[0]) : null;
}
