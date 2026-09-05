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

-- KAN-1138 (R10): mirrors the shape of packages/db/migrations/0009_slice10_events.sql
-- minus RLS/ulid/jsonb, same reasoning as every other table above. A
-- self-hosted instance's whole "publish" step for EventSignup blocks is
-- event-signup-seed.ts, seeding from the bundle's own
-- `prefab-event-signups.json` exactly the way forms-seed.ts/booking-seed.ts
-- already do. Capacity concurrency here needs no special handling at all:
-- better-sqlite3 is synchronous, so a single JS process can never interleave
-- two sign-ups for the same widget mid-transaction the way two concurrent
-- Postgres connections can (see event-signup-adapters.ts's own comment).
CREATE TABLE IF NOT EXISTS event_signup_widgets (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '[]',
  capacity INTEGER,
  waitlist_enabled INTEGER NOT NULL DEFAULT 1,
  submit_label TEXT NOT NULL DEFAULT 'Reserve my spot'
);

CREATE TABLE IF NOT EXISTS event_signups (
  id TEXT PRIMARY KEY,
  widget_id TEXT NOT NULL REFERENCES event_signup_widgets (id) ON DELETE CASCADE,
  site_id TEXT NOT NULL,
  values_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'waitlisted')),
  position INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS event_signups_widget_id_status_idx ON event_signups (widget_id, status);
CREATE INDEX IF NOT EXISTS event_signups_site_id_widget_id_created_at_idx ON event_signups (site_id, widget_id, created_at DESC, id);

-- Slice 10 / KAN-1137 (ADR-0005, R10): mirrors the shape of
-- packages/db/migrations/0009_slice10_payments.sql minus RLS/ulid/jsonb,
-- same reasoning as every other table above. Unlike calendar sync
-- (deliberately unavailable in self-host — see runtime-adapters.ts's own
-- comment), a one-off payment needs no platform dependency beyond the
-- OAuth connect step itself (ADR-0005: it's the tenant's own Stripe) — so,
-- unlike `calendar_connections`, this instance DOES get a `stripe_connections`
-- table and a connect/disconnect/status HTTP surface (see app.ts).
CREATE TABLE IF NOT EXISTS payment_blocks (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  button_label TEXT NOT NULL DEFAULT 'Pay now',
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  success_message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS stripe_connections (
  site_id TEXT PRIMARY KEY,
  stripe_account_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error'))
);

CREATE TABLE IF NOT EXISTS payment_records (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  block_id TEXT NOT NULL REFERENCES payment_blocks (id) ON DELETE CASCADE,
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  buyer_email TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS payment_records_site_id_block_id_idx ON payment_records (site_id, block_id, created_at DESC);

-- KAN-1154 / ADR-0016 (R10): mirrors the shape of
-- packages/db/migrations/0012_kan1154_subscriptions.sql minus RLS/ulid, same
-- reasoning as every other table above. `stripe_connections` above is
-- reused unchanged — a connected Stripe account is the same account
-- whether it's charged once or on a schedule. Part 1 (this card) only ever
-- writes 'incomplete' rows here; every other status value and every
-- lifecycle column below is written only by a follow-up card's webhook
-- consumer, which does not exist in self-host either yet.
CREATE TABLE IF NOT EXISTS subscription_blocks (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  button_label TEXT NOT NULL DEFAULT 'Subscribe',
  price INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  interval TEXT NOT NULL DEFAULT 'month' CHECK (interval IN ('month', 'year')),
  trial_period_days INTEGER NOT NULL DEFAULT 0,
  success_message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS subscription_records (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  block_id TEXT NOT NULL REFERENCES subscription_blocks (id) ON DELETE CASCADE,
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  price INTEGER NOT NULL,
  currency TEXT NOT NULL,
  interval TEXT NOT NULL CHECK (interval IN ('month', 'year')),
  trial_period_days INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'incomplete'
    CHECK (status IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  canceled_at TEXT,
  buyer_email TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS subscription_records_site_id_block_id_idx ON subscription_records (site_id, block_id, created_at DESC);
