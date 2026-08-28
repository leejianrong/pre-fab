-- Slice 4: custom domains and TLS — ADR-0007's "reachable on thousands of
-- customer-owned domains" promise, and ADR-0012's first paid gate.

CREATE TABLE custom_domains (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  hostname text NOT NULL UNIQUE,
  is_apex boolean NOT NULL,
  -- SLICES.md: "DNS verification polling with clear pending/failed/active
  -- states." Polling is lazy (checked on read / on-demand `domain.verify`),
  -- not a background job — this repo has no job queue yet, and a poll on
  -- read is enough for a resource that changes at DNS-propagation speed,
  -- not per-second.
  status text NOT NULL DEFAULT 'pending_dns' CHECK (status IN ('pending_dns', 'active', 'failed')),
  -- The Cloudflare (or fake, in dev/test) provider's own id for this
  -- custom hostname — needed to poll status and to deprovision on removal.
  provider_hostname_id text,
  -- What we told the owner to point their DNS at. Stored (not recomputed)
  -- so the dashboard's instructions stay stable even if the derivation
  -- logic changes later.
  cname_target text NOT NULL,
  -- SLICES.md: "a misconfigured DNS record produces a specific, actionable
  -- error." Null while pending or once active.
  verification_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by ulid NOT NULL REFERENCES accounts (id)
);

CREATE INDEX custom_domains_site_id_idx ON custom_domains (site_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON custom_domains TO prefab_app;

ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_domains FORCE ROW LEVEL SECURITY;

-- Owner-side CRUD: add/list/verify/remove, same tenant-context mechanism
-- as every other table (ADR-0008).
CREATE POLICY custom_domains_tenant_isolation ON custom_domains
  USING (site_id = current_setting('app.site_id', true));

-- The public routing path (apps/api's Host-header resolver) has no site_id
-- to set — that is exactly what it is resolving — so it reads with no
-- tenant context at all. Scoped to `active` rows only, and to SELECT only:
-- a domain still pending or failed must never be reachable, and this
-- policy grants no write access whatsoever. This is the same "a published
-- site's address is inherently public" reasoning that already makes
-- /v1/bundles/:hash/* unauthenticated (ADR-0007) — RLS here narrows what a
-- context-free read can see, it does not open a new capability.
CREATE POLICY custom_domains_public_active_read ON custom_domains
  FOR SELECT USING (status = 'active');

-- A live publish is, by definition, already being served to the public —
-- this is the same "a published site's address is public" reasoning as
-- custom_domains_public_active_read above, applied to `publishes` so the
-- policy just below can check "does this site have one" with no tenant
-- context. A publish that has never gone live, or was rolled back off of
-- live, stays fully protected by publishes_tenant_isolation.
CREATE POLICY publishes_public_live_read ON publishes
  FOR SELECT USING (is_live);

-- Same reasoning, on `sites`, for resolving "<slug>.prefab.app" to a site
-- — also has no site_id yet. Scoped to sites with a live publish only
-- (never `true`): an unpublished site's slug and name stay exactly as
-- private as everything else about it, since there would be nothing to
-- serve at its address anyway. This is what keeps the existing
-- cross-tenant-read RLS test correct — two freshly created, unpublished
-- sites are not readable across tenants, only a published one's slug is.
CREATE POLICY sites_public_slug_read ON sites
  FOR SELECT USING (EXISTS (SELECT 1 FROM publishes WHERE publishes.site_id = sites.id AND publishes.is_live));
