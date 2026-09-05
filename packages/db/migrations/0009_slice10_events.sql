-- KAN-1138: event sign-ups (RSVP), milestone 2's first slice. Much closer
-- to Slice 6's forms than Slice 9's booking calendar (0008_slice9.sql):
-- capacity is a property of one block, not a shared per-site calendar, so
-- there is no `availability_rules`-shaped table here at all — everything
-- this needs lives in the same two-table split Slice 6 established.
--
-- `event_signup_widgets` mirrors `forms` exactly (see 0006_slice6.sql's own
-- header comment for the full reasoning): the EventSignup block's own props
-- (heading/fields/capacity/waitlistEnabled/submitLabel) are portable page
-- content, authored in the page document, but the runtime's public sign-up
-- endpoint has no authenticated tenant context (a visitor is not a signed-in
-- owner) and must still resolve a blockId to a siteId — so this is the
-- publish-time snapshot that makes that possible, keyed by the block's own
-- id (never a separate synthetic id — the same single-id discipline
-- `forms`/`booking_widgets` already use, deliberately not reinvented here),
-- carrying only publish-safe columns and a public read policy.
--
-- `event_signups` mirrors `submissions`: visitor PII (whatever the owner's
-- field builder collected) that must never be readable with no tenant
-- context (R20). No `event_signup_settings` table exists — unlike forms,
-- there is no separate notify-configuration mutation for this block
-- (capacity/waitlist are already snapshotted onto the widget itself, and
-- owner notification resolves to the site's own account email, the same
-- way Slice 9's booking notifications do — see apps/api's event-signup
-- runtime route).
--
-- Concurrency (ADR-0006, applied to a new resource — mirrors 0008_slice9.sql's
-- own header comment on "double-booking the same slot"): unlike a booking's
-- exclusive slot, a sign-up's capacity is a *count*, not a single exclusive
-- resource, so a partial unique index cannot arbitrate it the way
-- `bookings_site_id_starts_at_confirmed_idx` does. Instead, @prefab/db's
-- event-signups repository takes out `SELECT ... FOR UPDATE` on the
-- widget's own row before counting confirmed sign-ups and deciding
-- confirmed-vs-waitlisted — the same "one row's lock is what actually
-- serializes concurrent writers" idea, applied as a row lock instead of a
-- uniqueness constraint because what's being protected is a count against a
-- threshold, not a single (site_id, starts_at) pair.

CREATE TABLE event_signup_widgets (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  -- A snapshot of the EventSignup block's own props, written by the publish
  -- pipeline every time the site publishes — mirrors upsertPublishedForm/
  -- upsertPublishedBookingWidget exactly.
  heading text NOT NULL DEFAULT '',
  fields jsonb NOT NULL DEFAULT '[]',
  -- NULL means unlimited — no waitlist is ever reachable for such a widget.
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  waitlist_enabled boolean NOT NULL DEFAULT true,
  submit_label text NOT NULL DEFAULT 'Reserve my spot',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_signup_widgets_site_id_idx ON event_signup_widgets (site_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON event_signup_widgets TO prefab_app;

ALTER TABLE event_signup_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_signup_widgets FORCE ROW LEVEL SECURITY;

CREATE POLICY event_signup_widgets_tenant_isolation ON event_signup_widgets
  USING (site_id = current_setting('app.site_id', true));

-- Same reasoning as forms_public_read/booking_widgets_public_read: every
-- column here is already publish-safe by construction, and the runtime's
-- public sign-up endpoint must resolve a widgetId to a siteId with no
-- signed-in principal.
CREATE POLICY event_signup_widgets_public_read ON event_signup_widgets
  FOR SELECT USING (true);

CREATE TABLE event_signups (
  id ulid PRIMARY KEY,
  widget_id ulid NOT NULL REFERENCES event_signup_widgets (id) ON DELETE CASCADE,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  -- The field-builder answers a visitor submitted — whatever the owner's
  -- fields collected (name/email/whatever custom fields they added).
  values jsonb NOT NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'waitlisted')),
  -- Only meaningful when status = 'waitlisted' — this sign-up's place in
  -- line, assigned once under the widget row's own lock (see this
  -- migration's own header comment) and never renumbered afterward, even
  -- once an earlier waitlisted sign-up is later promoted or deleted.
  position integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_signups_site_id_widget_id_created_at_idx ON event_signups (site_id, widget_id, created_at DESC, id);
-- What the create-time capacity check counts against — every confirmed (or
-- waitlisted) sign-up for one widget, the hot path `SELECT ... FOR UPDATE`
-- immediately follows with.
CREATE INDEX event_signups_widget_id_status_idx ON event_signups (widget_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON event_signups TO prefab_app;

ALTER TABLE event_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_signups FORCE ROW LEVEL SECURITY;

-- Written by the runtime sign-up endpoint with app.site_id set explicitly to
-- the siteId it already resolved from the public
-- `event_signup_widgets` read above (never from visitor input) — the same
-- "server resolves, then scopes" pattern createSubmission already uses. No
-- public policy: sign-up contents are visitor PII, readable only by the
-- owning tenant (R20).
CREATE POLICY event_signups_tenant_isolation ON event_signups
  USING (site_id = current_setting('app.site_id', true));
