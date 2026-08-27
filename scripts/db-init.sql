-- Shared by scripts/db-up.sh (local dev) and .github/workflows/ci.yml (CI's
-- Postgres service container) — one definition of the two roles ADR-0008
-- depends on, so local dev and CI can never quietly diverge on this.
DO $$
BEGIN
  -- Owns the schema, runs migrations. Table ownership would bypass RLS, so
  -- the application never connects as this role (ADR-0008).
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'prefab') THEN
    CREATE ROLE prefab WITH LOGIN PASSWORD 'prefab' CREATEDB;
  END IF;
  -- What apps/api actually connects as: a non-owner grantee, so RLS applies
  -- unconditionally regardless of FORCE ROW LEVEL SECURITY.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'prefab_app') THEN
    CREATE ROLE prefab_app WITH LOGIN PASSWORD 'prefab_app';
  END IF;
END
$$;
