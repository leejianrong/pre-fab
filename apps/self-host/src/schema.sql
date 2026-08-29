-- Self-host's own SQLite schema (ADR-0010 tier b) — mirrors the shape of
-- packages/db/migrations/0006_slice6.sql (forms/form_settings/submissions/
-- webhook_deliveries), minus RLS and Postgres-specific types, since a
-- self-hosted instance serves exactly one site with no other tenant to
-- isolate from. `CREATE TABLE IF NOT EXISTS` rather than a migration
-- runner — self-host has no history of prior schema versions to step
-- through yet; this is the whole schema, applied idempotently on every
-- start.

CREATE TABLE IF NOT EXISTS forms (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '[]',
  submit_label TEXT NOT NULL DEFAULT 'Submit',
  turnstile_enabled INTEGER NOT NULL DEFAULT 0
);

-- Deliberately separate from `forms`, same reasoning as
-- 0006_slice6.sql's own split: notifyEmail/webhookUrl/webhookSecret are
-- credential-shaped (R20) and are never written by seeding a bundle's
-- prefab-forms.json — only an operator, editing this file (or its row)
-- directly, ever sets them.
CREATE TABLE IF NOT EXISTS form_settings (
  form_id TEXT PRIMARY KEY REFERENCES forms (id) ON DELETE CASCADE,
  site_id TEXT NOT NULL,
  notify_email TEXT,
  webhook_url TEXT,
  webhook_secret TEXT
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  form_id TEXT NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  values_json TEXT NOT NULL,
  ip TEXT,
  notify_status TEXT NOT NULL DEFAULT 'skipped' CHECK (notify_status IN ('skipped', 'sent', 'failed')),
  notify_error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS submissions_form_id_created_at_idx ON submissions (form_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  submission_id TEXT NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT,
  payload_json TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  last_error TEXT,
  next_attempt_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_status_next_attempt_idx ON webhook_deliveries (status, next_attempt_at);
