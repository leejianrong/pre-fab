-- Slice 2: block-level responsive overrides (ADR-0002 extension) and
-- content-addressed asset storage.

ALTER TABLE blocks ADD COLUMN responsive jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Content-addressed by sha256 (R8/R9 portability: assets are referenced by
-- hash, never by a mutable path, so an exported site tree's asset
-- references stay valid regardless of where the bytes are stored).
CREATE TABLE assets (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  sha256 text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  filename text NOT NULL,
  width integer,
  height integer,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by ulid NOT NULL REFERENCES accounts (id),
  UNIQUE (site_id, sha256)
);

CREATE INDEX assets_site_id_idx ON assets (site_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON assets TO prefab_app;

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets FORCE ROW LEVEL SECURITY;

CREATE POLICY assets_tenant_isolation ON assets
  USING (site_id = current_setting('app.site_id', true));
