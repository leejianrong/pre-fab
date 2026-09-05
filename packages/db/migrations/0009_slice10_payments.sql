-- Slice 10 / KAN-1137: one-off payment blocks, bring-your-own Stripe
-- (ADR-0005). Three tables, split along the same lines Slice 6 (forms) and
-- Slice 9 (bookings/calendar_connections) already established:
--
-- `payment_blocks` mirrors `booking_widgets` exactly and for the same
-- reason: the Payment block's own props (heading/description/buttonLabel/
-- amount/currency/successMessage) are portable page content, authored in
-- the page document, but the runtime's public checkout endpoint has no
-- authenticated tenant context (a visitor is not a signed-in owner) and
-- must still resolve a blockId to a siteId *and* the amount/currency to
-- charge — critically, from this snapshot, never from the visitor's own
-- request body, or a tampered request could pay whatever it wants. This is
-- the publish-time snapshot that makes that possible, carrying only
-- publish-safe columns and a public read policy, exactly like `forms`/
-- `booking_widgets`.
--
-- `stripe_connections` mirrors `calendar_connections`' shape and RLS policy
-- exactly, but simpler: a Stripe Standard OAuth access token has no
-- refresh cycle to manage (unlike Google/Microsoft's), so there is no
-- refresh_token/token_expires_at pair here at all. Credential-shaped (R20's
-- platform equivalent — never in a site source tree, and here never
-- publicly readable either): tenant-isolation only, no public policy, ever.
--
-- `payment_records` mirrors `submissions`/`bookings`: visitor PII and
-- payment metadata (buyer_email, amount, status) that must never be
-- readable with no tenant context (R20's "never in a table any
-- unauthenticated request can read" — the platform equivalent of "never in
-- a site source tree"). No public policy, ever — the runtime resolves
-- tenant context explicitly from the siteId it already derived via
-- `payment_blocks_public_read` before ever touching this table, the same
-- "resolve, then scope" shape `createSubmission` already uses with no
-- principal at all.

CREATE TABLE payment_blocks (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  -- A snapshot of the Payment block's own props, written by the publish
  -- pipeline every time the site publishes — mirrors upsertPublishedForm/
  -- upsertPublishedBookingWidget exactly, including why.
  heading text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  button_label text NOT NULL DEFAULT 'Pay now',
  -- Cents, always a positive integer — the one field a tampered visitor
  -- request must never be able to override (see this migration's own
  -- header comment).
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'usd',
  success_message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_blocks_site_id_idx ON payment_blocks (site_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON payment_blocks TO prefab_app;

ALTER TABLE payment_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_blocks FORCE ROW LEVEL SECURITY;

CREATE POLICY payment_blocks_tenant_isolation ON payment_blocks
  USING (site_id = current_setting('app.site_id', true));

-- Same reasoning as forms_public_read/booking_widgets_public_read: every
-- column here is already publish-safe by construction, and the runtime's
-- public checkout endpoint must resolve a blockId to a siteId with no
-- signed-in principal.
CREATE POLICY payment_blocks_public_read ON payment_blocks
  FOR SELECT USING (true);

CREATE TABLE stripe_connections (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL UNIQUE REFERENCES sites (id) ON DELETE CASCADE,
  stripe_account_id text NOT NULL,
  -- Credential-shaped (R20's platform equivalent — never in a site source
  -- tree, and here never publicly readable either): the OAuth access token
  -- for the tenant's own connected Stripe account. No refresh token/expiry
  -- — Stripe Standard OAuth access tokens don't expire on a timer the way
  -- Google/Microsoft's do. No public policy at all, same as
  -- calendar_connections/form_settings.
  access_token text NOT NULL,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON stripe_connections TO prefab_app;

ALTER TABLE stripe_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_connections FORCE ROW LEVEL SECURITY;

CREATE POLICY stripe_connections_tenant_isolation ON stripe_connections
  USING (site_id = current_setting('app.site_id', true));

CREATE TABLE payment_records (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  block_id ulid NOT NULL REFERENCES payment_blocks (id) ON DELETE CASCADE,
  stripe_session_id text NOT NULL,
  -- Only known once Checkout actually completes (webhook/dev-advance) —
  -- null for the whole "pending" lifetime of a session nobody has paid yet.
  stripe_payment_intent_id text,
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  buyer_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_records_site_id_block_id_created_at_idx ON payment_records (site_id, block_id, created_at DESC, id);
-- checkout.session.completed (and the dev-advance equivalent) look a
-- session up by id alone, with no siteId in hand yet — this is what makes
-- that lookup a plain index scan rather than a sequential one.
CREATE UNIQUE INDEX payment_records_stripe_session_id_idx ON payment_records (stripe_session_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON payment_records TO prefab_app;

ALTER TABLE payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_records FORCE ROW LEVEL SECURITY;

-- No public policy — see this migration's own header comment for why.
-- Every runtime access (checkout create, webhook/dev-advance completion,
-- owner list) sets app.site_id explicitly before ever touching this table.
CREATE POLICY payment_records_tenant_isolation ON payment_records
  USING (site_id = current_setting('app.site_id', true));
