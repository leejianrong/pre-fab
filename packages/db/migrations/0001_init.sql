-- Slice 1 schema. Run as the `prefab` (owner) role; apps/api never connects
-- as this role (ADR-0008 — ownership would bypass RLS).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE DOMAIN ulid AS text CHECK (VALUE ~ '^[0-9A-HJKMNP-TV-Z]{26}$');

-- Identity (ADR-0001 minimal identity). Not RLS-scoped: not tenant data,
-- and it is what lets us *resolve* a tenant before RLS context exists.
CREATE TABLE accounts (
  id ulid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id ulid PRIMARY KEY,
  account_id ulid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE api_tokens (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL,
  account_id ulid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

-- Tenant data (ADR-0002 / ADR-0008). RLS keyed on site_id from here down.
CREATE TABLE sites (
  id ulid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  owner_id ulid NOT NULL REFERENCES accounts (id),
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE api_tokens
  ADD CONSTRAINT api_tokens_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites (id) ON DELETE CASCADE;

CREATE TABLE themes (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL UNIQUE REFERENCES sites (id) ON DELETE CASCADE,
  schema_version integer NOT NULL DEFAULT 1,
  tokens jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pages (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  -- Optimistic-concurrency version (ADR-0006 / R17). Incremented on every
  -- accepted write to this page's fields or its blocks.
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug)
);

-- Flat, ULID-keyed, parent + order (ADR-0002) — never a nested tree, never
-- a positional reference, at the storage layer too.
CREATE TABLE blocks (
  id ulid PRIMARY KEY,
  page_id ulid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  type text NOT NULL,
  parent ulid REFERENCES blocks (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  "order" double precision NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  props jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX blocks_page_id_idx ON blocks (page_id);

CREATE TABLE publishes (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  -- Content-addressed bundle location (ADR-0007) — immutable once written.
  bundle_path text NOT NULL,
  content_hash text NOT NULL,
  is_live boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by ulid NOT NULL REFERENCES accounts (id)
);

-- At most one live publish per site — this row flip *is* the pointer swap
-- that makes R4 (atomic publish) and R5 (instant rollback) fall out for free.
CREATE UNIQUE INDEX publishes_one_live_per_site ON publishes (site_id) WHERE is_live;

-- The role apps/api actually connects as. Granted, not owning, so RLS
-- applies unconditionally (ADR-0008). scripts/db-up.sh creates the role and
-- grants CONNECT on the database; this migration grants table privileges.
GRANT SELECT, INSERT, UPDATE, DELETE ON accounts, sessions, api_tokens TO prefab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sites, themes, pages, blocks, publishes TO prefab_app;

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishes ENABLE ROW LEVEL SECURITY;

-- FORCE is belt-and-suspenders: prefab_app is not the table owner, so RLS
-- already applies regardless, but this keeps the guarantee independent of
-- who ends up owning these tables later.
ALTER TABLE sites FORCE ROW LEVEL SECURITY;
ALTER TABLE themes FORCE ROW LEVEL SECURITY;
ALTER TABLE pages FORCE ROW LEVEL SECURITY;
ALTER TABLE blocks FORCE ROW LEVEL SECURITY;
ALTER TABLE publishes FORCE ROW LEVEL SECURITY;

-- Tenant context is set per transaction as `app.site_id` (ADR-0008). A
-- connection with no context set sees no rows at all — fail closed, not open.
CREATE POLICY sites_tenant_isolation ON sites
  USING (id = current_setting('app.site_id', true));

CREATE POLICY themes_tenant_isolation ON themes
  USING (site_id = current_setting('app.site_id', true));

CREATE POLICY pages_tenant_isolation ON pages
  USING (site_id = current_setting('app.site_id', true));

CREATE POLICY blocks_tenant_isolation ON blocks
  USING (site_id = current_setting('app.site_id', true));

CREATE POLICY publishes_tenant_isolation ON publishes
  USING (site_id = current_setting('app.site_id', true));

-- Site creation/listing happens before a site_id is known — scoped to the
-- owning account instead. Two separate policies (RLS OR-combines policies
-- of the same command) so either context can grant access.
CREATE POLICY sites_owner_access ON sites
  USING (owner_id = current_setting('app.account_id', true));
