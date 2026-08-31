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

-- Slice 9 (ADR-0009, R10): mirrors the shape of
-- packages/db/migrations/0008_slice9.sql minus RLS/ulid/jsonb, same
-- reasoning as forms/form_settings/submissions/webhook_deliveries above.
-- No `calendar_connections` table here at all: a self-hosted instance has
-- no OAuth callback surface to offer two-way sync from in this milestone
-- (see runtime-adapters.ts's own comment) — local availability rules and
-- bookings are what R10 actually requires to keep working.
CREATE TABLE IF NOT EXISTS availability_rules (
  site_id TEXT PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  weekly_windows TEXT NOT NULL DEFAULT '[]',
  date_overrides TEXT NOT NULL DEFAULT '[]',
  slot_duration_minutes INTEGER NOT NULL DEFAULT 30,
  buffer_before_minutes INTEGER NOT NULL DEFAULT 0,
  buffer_after_minutes INTEGER NOT NULL DEFAULT 0,
  min_notice_minutes INTEGER NOT NULL DEFAULT 60,
  max_horizon_days INTEGER NOT NULL DEFAULT 30
);

CREATE TABLE IF NOT EXISTS booking_widgets (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  confirm_label TEXT NOT NULL DEFAULT 'Confirm booking',
  success_message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  widget_id TEXT NOT NULL REFERENCES booking_widgets (id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  visitor_name TEXT NOT NULL,
  visitor_email TEXT NOT NULL,
  visitor_timezone TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'canceled')),
  manage_token_hash TEXT NOT NULL UNIQUE,
  external_event_id TEXT,
  created_at TEXT NOT NULL,
  canceled_at TEXT
);

-- Same double-booking guarantee as the Postgres side's partial unique
-- index — SQLite's own UNIQUE index likewise only ever counts one 'live'
-- row per (site_id, starts_at) toward the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_site_id_starts_at_confirmed_idx ON bookings (site_id, starts_at) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS bookings_site_id_widget_id_starts_at_idx ON bookings (site_id, widget_id, starts_at);
