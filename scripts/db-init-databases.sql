-- Companion to scripts/db-init.sql (roles only). CREATE DATABASE cannot run
-- inside that file's DO $$...$$ block, so it's split out here. Mounted as
-- the second docker-entrypoint-initdb.d script in docker-compose.yml, right
-- after db-init.sql creates the prefab/prefab_app roles these statements
-- reference. Mirrors the per-database steps .github/workflows/ci.yml runs
-- against its own Postgres service container, plus prefab_dev, which CI
-- never needs but local dev does.
CREATE DATABASE prefab_dev OWNER prefab;
CREATE DATABASE prefab_test OWNER prefab;
CREATE DATABASE prefab_e2e OWNER prefab;

GRANT CONNECT ON DATABASE prefab_dev TO prefab_app;
GRANT CONNECT ON DATABASE prefab_test TO prefab_app;
GRANT CONNECT ON DATABASE prefab_e2e TO prefab_app;
