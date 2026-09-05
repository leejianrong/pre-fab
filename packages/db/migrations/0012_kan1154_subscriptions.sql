-- KAN-1154 / ADR-0016: recurring/subscription payment blocks, bring-your-own
-- Stripe. A distinct table pair, sibling to 0009_slice10_payments.sql's
-- `payment_blocks`/`payment_records` rather than new columns on either — see
-- ADR-0016's questions 1 and 3 for the full reasoning (a per-interval price
-- is not a one-time amount, and a subscription's lifecycle is written to
-- indefinitely rather than once). `stripe_connections` (also from
-- 0009_slice10_payments.sql) is reused as-is: a connected Stripe account is
-- the same account whether it's charged once or on a schedule.
--
-- `subscription_blocks` mirrors `payment_blocks` exactly (same publish-time
-- snapshot reasoning: the runtime's checkout endpoint has no authenticated
-- tenant context, and must resolve a blockId to a siteId and a trusted
-- price/interval/trial without ever taking them from a visitor's own
-- request).
--
-- `subscription_records` mirrors `payment_records`, but its lifecycle is
-- open-ended rather than write-once: a row is created here by THIS card's
-- checkout-session creation (status 'incomplete', mirroring
-- `payment_records.status` defaulting to 'pending' for the same "session
-- might still be abandoned" reason) and is expected to be REWRITTEN
-- repeatedly over its life by a follow-up card's webhook consumer
-- (KAN-1154 part 2) — renewals, dunning, cancellation. `status` stores
-- Stripe's OWN Subscription.status vocabulary verbatim (see ADR-0016's
-- question 2 for why: no platform-invented projection, no translation step
-- part 2 has to get right with no live account to verify against).
-- `stripe_subscription_id`/`stripe_customer_id`/`current_period_end`/
-- `cancel_at_period_end`/`canceled_at` are all nullable/defaulted because
-- none of them are known at checkout-session-creation time — a Subscription
-- object doesn't exist until Stripe Checkout completes — and nothing in
-- this migration or this card's code ever populates them; they exist so
-- part 2's webhook handler has somewhere to write without a second
-- migration.

CREATE TABLE subscription_blocks (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  -- A snapshot of the Subscription block's own props, written by the
  -- publish pipeline every time the site publishes — mirrors
  -- upsertPublishedPaymentBlock exactly.
  heading text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  button_label text NOT NULL DEFAULT 'Subscribe',
  -- Cents PER INTERVAL, always a positive integer — the one field a
  -- tampered visitor request must never be able to override (see this
  -- migration's own header comment). Named `price`, not `amount`: ADR-0016
  -- question 1.
  price integer NOT NULL CHECK (price > 0),
  currency text NOT NULL DEFAULT 'usd',
  interval text NOT NULL DEFAULT 'month' CHECK (interval IN ('month', 'year')),
  trial_period_days integer NOT NULL DEFAULT 0 CHECK (trial_period_days >= 0),
  success_message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_blocks_site_id_idx ON subscription_blocks (site_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_blocks TO prefab_app;

ALTER TABLE subscription_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_blocks FORCE ROW LEVEL SECURITY;

CREATE POLICY subscription_blocks_tenant_isolation ON subscription_blocks
  USING (site_id = current_setting('app.site_id', true));

-- Same reasoning as payment_blocks_public_read: every column here is
-- already publish-safe by construction, and the runtime's public checkout
-- endpoint must resolve a blockId to a siteId with no signed-in principal.
CREATE POLICY subscription_blocks_public_read ON subscription_blocks
  FOR SELECT USING (true);

CREATE TABLE subscription_records (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  block_id ulid NOT NULL REFERENCES subscription_blocks (id) ON DELETE CASCADE,
  stripe_checkout_session_id text NOT NULL,
  -- Both unknown until Checkout completes and a real Subscription object
  -- exists — populated only by part 2's webhook handler (or its dev-advance
  -- equivalent), never by this card's checkout-session creation.
  stripe_subscription_id text,
  stripe_customer_id text,
  -- Cents per interval, snapshotted from subscription_blocks at the moment
  -- this record was created (same "never trust the visitor" reasoning as
  -- payment_records.amount).
  price integer NOT NULL CHECK (price > 0),
  currency text NOT NULL,
  interval text NOT NULL CHECK (interval IN ('month', 'year')),
  trial_period_days integer NOT NULL DEFAULT 0 CHECK (trial_period_days >= 0),
  -- Stripe's OWN Subscription.status vocabulary, stored verbatim — see this
  -- migration's own header comment and ADR-0016's question 2. 'incomplete'
  -- is the state a row is created in by this card's checkout-session
  -- creation; every other value is written only by part 2's webhook
  -- handler, which does not exist yet.
  status text NOT NULL DEFAULT 'incomplete'
    CHECK (status IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  buyer_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_records_site_id_block_id_created_at_idx ON subscription_records (site_id, block_id, created_at DESC, id);
-- A future webhook handler (part 2) looks a session up by id alone, with no
-- siteId in hand yet — mirrors payment_records_stripe_session_id_idx
-- exactly, for the identical reason.
CREATE UNIQUE INDEX subscription_records_stripe_checkout_session_id_idx ON subscription_records (stripe_checkout_session_id);
-- A future webhook handler also needs to resolve an ongoing subscription by
-- its Stripe subscription id (renewal/dunning/cancellation events all carry
-- this, not the original checkout session id) — nullable/unique together
-- (multiple NULLs allowed, exactly one row per non-null subscription id).
CREATE UNIQUE INDEX subscription_records_stripe_subscription_id_idx ON subscription_records (stripe_subscription_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_records TO prefab_app;

ALTER TABLE subscription_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_records FORCE ROW LEVEL SECURITY;

-- No public policy — same reasoning as payment_records: visitor
-- PII/subscription metadata, every runtime access sets app.site_id
-- explicitly before ever touching this table.
CREATE POLICY subscription_records_tenant_isolation ON subscription_records
  USING (site_id = current_setting('app.site_id', true));
