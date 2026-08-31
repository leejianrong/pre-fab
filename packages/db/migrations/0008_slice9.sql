-- Slice 9: scheduling and bookings (ADR-0009, R10, R20). Built, not bought
-- (Cal.com is AGPLv3) — see docs/adr/0009-build-booking-core-not-calcom.md.
--
-- Four tables, split along the same lines Slice 6 established for forms:
--
-- `availability_rules` is one row per site (the owner's weekly windows,
-- date overrides, buffers, minimum notice and maximum horizon) — a
-- platform/dashboard setting, not page-document content, so unlike a Form
-- block's field definitions it has no separate "publish-safe snapshot" step:
-- `availability.set` writes the one row the runtime already reads.
--
-- `booking_widgets` mirrors `forms` exactly and for the same reason: the
-- Booking block's own props (heading/description/labels) are portable page
-- content, authored in the page document, but the runtime's public
-- slot/booking endpoints have no authenticated tenant context (a visitor is
-- not a signed-in owner) and must still resolve a blockId to a siteId — so
-- this is the publish-time snapshot that makes that possible, carrying only
-- publish-safe columns and a public read policy, exactly like `forms`.
--
-- `bookings` mirrors `submissions`: visitor PII (name, email, notes) that
-- must never be readable with no tenant context (R20's "never in a table
-- any unauthenticated request can read" — the platform equivalent of "never
-- in a site source tree"). A visitor's own cancel/reschedule link carries
-- both the siteId and a bearer token (`manage_token_hash`, hashed exactly
-- like a session/API token — see @prefab/db's hashToken) rather than
-- relying on a public read policy: the runtime sets tenant context
-- explicitly from the siteId already in the URL, then looks the booking up
-- by id *and* matching token hash under `bookings_tenant_isolation`, the
-- same "server resolves site context first, then scopes" shape
-- `createSubmission` already uses with no principal at all.
--
-- `calendar_connections` is credential-shaped (OAuth tokens) exactly like
-- `form_settings`/the Slice 8 Stripe columns — tenant-isolation only, no
-- public policy, ever.
--
-- Concurrency (ADR-0006, applied to a new resource — SLICES.md: "double-
-- booking the same slot concurrently: one succeeds, one is rejected
-- cleanly"): a partial unique index on confirmed bookings is the only thing
-- that can actually guarantee this under real concurrent writes from two
-- separate connections — the same reasoning `writePageDocument`'s
-- expectedVersion check exists for, applied here as a uniqueness constraint
-- instead because a slot, unlike a page, has no prior version to compare
-- against on its first booking.

CREATE TABLE availability_rules (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL UNIQUE REFERENCES sites (id) ON DELETE CASCADE,
  -- IANA zone the owner's weekly windows are expressed in local wall-clock
  -- time against — this is what makes "9am–5pm on weekdays" mean the same
  -- thing across a DST transition rather than drifting by an hour.
  timezone text NOT NULL DEFAULT 'UTC',
  -- [{ dayOfWeek: 0-6, startMinute: 0-1439, endMinute: 1-1440 }, ...]
  weekly_windows jsonb NOT NULL DEFAULT '[]',
  -- [{ date: 'YYYY-MM-DD', closed: boolean, windows: [{startMinute,endMinute}] }, ...]
  -- A date present here always wins over that date's weekly window.
  date_overrides jsonb NOT NULL DEFAULT '[]',
  slot_duration_minutes integer NOT NULL DEFAULT 30 CHECK (slot_duration_minutes > 0),
  buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
  min_notice_minutes integer NOT NULL DEFAULT 60 CHECK (min_notice_minutes >= 0),
  max_horizon_days integer NOT NULL DEFAULT 30 CHECK (max_horizon_days > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON availability_rules TO prefab_app;

ALTER TABLE availability_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_rules FORCE ROW LEVEL SECURITY;

-- No public policy: the runtime always resolves siteId first via
-- `booking_widgets_public_read` below, then reads this table with tenant
-- context explicitly set to that siteId — the same "resolve, then scope"
-- shape `form_settings` already uses with no public exposure at all.
CREATE POLICY availability_rules_tenant_isolation ON availability_rules
  USING (site_id = current_setting('app.site_id', true));

CREATE TABLE booking_widgets (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  -- A snapshot of the Booking block's own props, written by the publish
  -- pipeline every time the site publishes — mirrors upsertPublishedForm
  -- exactly, including why (the runtime never reads pages/blocks directly).
  heading text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  confirm_label text NOT NULL DEFAULT 'Confirm booking',
  success_message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX booking_widgets_site_id_idx ON booking_widgets (site_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON booking_widgets TO prefab_app;

ALTER TABLE booking_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_widgets FORCE ROW LEVEL SECURITY;

CREATE POLICY booking_widgets_tenant_isolation ON booking_widgets
  USING (site_id = current_setting('app.site_id', true));

-- Same reasoning as forms_public_read: every column here is already
-- publish-safe by construction, and the runtime's public slot/booking
-- endpoints must resolve a widgetId to a siteId with no signed-in principal.
CREATE POLICY booking_widgets_public_read ON booking_widgets
  FOR SELECT USING (true);

CREATE TABLE bookings (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  widget_id ulid NOT NULL REFERENCES booking_widgets (id) ON DELETE CASCADE,
  -- Always stored in UTC (timestamptz) — DST correctness is a
  -- slot-computation and ICS-generation concern (@prefab/runtime), never a
  -- storage one: a booking's instant in time never changes across a DST
  -- transition, only its local rendering does.
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  visitor_name text NOT NULL,
  visitor_email text NOT NULL,
  -- The visitor's own IANA zone at booking time — needed to render their
  -- confirmation/ICS in the timezone they actually picked the slot in.
  visitor_timezone text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'canceled')),
  -- Hashed exactly like a session/API token (@prefab/db's hashToken) — the
  -- raw token lives only in the cancel/reschedule link a visitor is emailed,
  -- never persisted in plaintext.
  manage_token_hash text NOT NULL UNIQUE,
  -- The calendar provider's own event id, once pushed (best-effort, see
  -- @prefab/runtime's book.ts) — needed to update/delete that event on
  -- reschedule/cancel. Null when no calendar is connected or the push
  -- failed (a booking is never blocked on this succeeding).
  external_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  canceled_at timestamptz
);

CREATE INDEX bookings_site_id_widget_id_starts_at_idx ON bookings (site_id, widget_id, starts_at);

-- The double-booking guarantee (SLICES.md): two concurrent INSERTs for the
-- same site and start time can never both succeed — the loser's INSERT
-- fails a unique-violation, which @prefab/runtime's book.ts turns into a
-- clean "slot_taken" outcome rather than a 500. Partial (WHERE status =
-- 'confirmed') so a canceled booking never blocks the slot it released.
CREATE UNIQUE INDEX bookings_site_id_starts_at_confirmed_idx ON bookings (site_id, starts_at) WHERE status = 'confirmed';

GRANT SELECT, INSERT, UPDATE, DELETE ON bookings TO prefab_app;

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings FORCE ROW LEVEL SECURITY;

-- No public policy — see this migration's own header comment for why. Every
-- runtime access (visitor create/cancel/reschedule, owner list/cancel) sets
-- app.site_id explicitly before ever touching this table.
CREATE POLICY bookings_tenant_isolation ON bookings
  USING (site_id = current_setting('app.site_id', true));

CREATE TABLE calendar_connections (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL UNIQUE REFERENCES sites (id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error')),
  external_calendar_id text,
  -- Credential-shaped (R20's platform equivalent — never in a site source
  -- tree, and here never publicly readable either): an OAuth access/refresh
  -- token pair. No public policy at all, same as form_settings/Stripe.
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_connections TO prefab_app;

ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_connections FORCE ROW LEVEL SECURITY;

CREATE POLICY calendar_connections_tenant_isolation ON calendar_connections
  USING (site_id = current_setting('app.site_id', true));
