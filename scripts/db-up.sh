#!/usr/bin/env bash
# Starts a local Postgres 16 cluster and ensures the prefab dev/test roles and
# databases exist. Slice 1 runs directly against system Postgres rather than
# a container — see README.md for why.
set -euo pipefail

sudo pg_ctlcluster 16 main start 2>/dev/null || true
sudo service postgresql start >/dev/null 2>&1 || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo -u postgres psql -v ON_ERROR_STOP=1 -f "${SCRIPT_DIR}/db-init.sql"

for db in prefab_dev prefab_test prefab_e2e; do
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1 \
    || sudo -u postgres createdb -O prefab "${db}"
  sudo -u postgres psql -d "${db}" -c "GRANT CONNECT ON DATABASE ${db} TO prefab_app;" >/dev/null
done

echo "postgres ready:"
echo "  migrate as: postgres://prefab:prefab@localhost:5432/{prefab_dev,prefab_test,prefab_e2e}"
echo "  app runs as: postgres://prefab_app:prefab_app@localhost:5432/{prefab_dev,prefab_test,prefab_e2e}"
