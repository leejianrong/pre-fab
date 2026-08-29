-- Slice 8: accounts, plans and billing (ADR-0005, ADR-0012). Two additions:
--
-- 1. `site_members` — owner/editor/viewer roles. Replaces `sites.owner_id`
--    as the *access* mechanism (owner_id is kept as the historical/display
--    field; every access check now goes through this table instead). Every
--    site gets an explicit `owner` row created in the same transaction as
--    the site itself (see apps/api's site.create / site.createFromTemplate);
--    this migration backfills one for every site that already exists.
--
-- 2. `subscriptions` — *our* billing for the account (Stripe subscriptions
--    for prefab's own plans), explicitly not RLS-scoped, for the same
--    reason `accounts`/`sessions`/`api_tokens` in 0001_init.sql are not:
--    this is identity/account data, not tenant (site) data, and a Stripe
--    webhook must be able to resolve "which account does this
--    stripe_customer_id belong to" with no site_id and no account_id in
--    hand yet — that is exactly what the webhook is establishing. Kept
--    strictly separate from any future tenant-owned BYO-Stripe table
--    (ADR-0005, milestone 2) — different concern, different credentials,
--    different lifecycle, never the same row.
-- `stripe_webhook_events` gives the inbound webhook handler the same
-- exactly-once guarantee outbound webhook delivery already has for retries
-- (apps/api/src/lib/webhooks.ts) but in the other direction: Stripe itself
-- retries delivery, so the handler must tolerate seeing the same event.id
-- more than once.

CREATE TABLE site_members (
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  account_id ulid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, account_id)
);

CREATE INDEX site_members_account_id_idx ON site_members (account_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON site_members TO prefab_app;

ALTER TABLE site_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_members FORCE ROW LEVEL SECURITY;

-- Same tenant-context mechanism as every other site-scoped table
-- (ADR-0008) — lets a request already inside a site's tenant context (the
-- authorizeSite role lookup, or an owner listing/managing members) see
-- every membership row for that site.
CREATE POLICY site_members_tenant_isolation ON site_members
  USING (site_id = current_setting('app.site_id', true));

-- Lets an account see its own membership rows before any particular
-- site_id is in context — the same "resolve identity before tenant
-- context" shape as sites_owner_access (0001_init.sql).
CREATE POLICY site_members_account_access ON site_members
  USING (account_id = current_setting('app.account_id', true));

-- An invited editor or viewer is not the owner, so sites_owner_access
-- alone would hide the site row itself from them. RLS OR-combines
-- policies on the same command (same mechanism sites_owner_access already
-- relies on), so this simply adds a second way to see a site row.
CREATE POLICY sites_member_access ON sites
  USING (EXISTS (SELECT 1 FROM site_members m WHERE m.site_id = sites.id AND m.account_id = current_setting('app.account_id', true)));

-- Backfill: every site that already exists gets its owner as an explicit
-- 'owner' row, so the new membership-based access check never regresses
-- access for a site created before this migration ran. FORCE ROW LEVEL
-- SECURITY applies to the migration-owning role too (the whole point of
-- FORCE — see 0001_init.sql), so this runs as a DO block setting the same
-- `app.site_id`/`app.account_id` GUCs per row that withTenantContext sets
-- at request time, rather than as a plain bulk INSERT.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, owner_id FROM sites LOOP
    PERFORM set_config('app.site_id', r.id, true);
    PERFORM set_config('app.account_id', r.owner_id, true);
    INSERT INTO site_members (site_id, account_id, role) VALUES (r.id, r.owner_id, 'owner')
    ON CONFLICT (site_id, account_id) DO NOTHING;
  END LOOP;
  PERFORM set_config('app.site_id', '', true);
  PERFORM set_config('app.account_id', '', true);
END $$;

-- Not RLS-scoped — see the module comment above. One row per account,
-- created lazily (getOrCreateSubscription) the first time anything needs
-- it, so an account with no billing history yet still reads as an
-- ordinary free/active row rather than requiring null-checks everywhere.
CREATE TABLE subscriptions (
  id ulid PRIMARY KEY,
  account_id ulid NOT NULL UNIQUE REFERENCES accounts (id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled')),
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  -- Set on a failed payment (invoice.payment_failed): the account keeps
  -- full pro access through this date — "a grace state, not immediate
  -- takedown" (SLICES.md) — and reactivation (invoice.payment_succeeded)
  -- clears it.
  grace_period_ends_at timestamptz,
  -- Set on cancellation: R7/ADR-0012 — export keeps working, and the site
  -- keeps serving, until this date.
  canceled_at timestamptz,
  retention_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions TO prefab_app;

CREATE TABLE stripe_webhook_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON stripe_webhook_events TO prefab_app;
