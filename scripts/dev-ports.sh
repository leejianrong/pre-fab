#!/usr/bin/env bash
# Auto-picks free host ports for `make dev`/`make up` and writes them into
# .env, so two worktrees of this repo (or this repo alongside an unrelated
# project) never have to fight over 5173/8787/5432 by hand.
#
# Safe by construction: every inter-container hop (editor -> api, api/migrate
# -> postgres) already goes over Docker's internal network using service
# names and *container* ports (see docker-compose.yml's PREFAB_API_PROXY_TARGET
# and the migrate/api services' own DATABASE_URL) — none of that is affected
# by which HOST port a service happens to be published on. Only host-facing
# consumers (your browser, the CLI/MCP running natively, `psql` from the
# host) care about the values this script writes, which is exactly why
# reassigning them here is risk-free.
#
# If docker-compose.override.yml is present (see
# docker-compose.override.yml.example), the editor is reached through a
# machine-wide Traefik instance at http://pre-fab.localhost/ instead —
# that override hardcodes its own EDITOR_ORIGIN in YAML, so this script's
# PREFAB_EDITOR_HOST_PORT/.env changes are harmless but moot for the
# editor's URL in that mode; only the printed summary needs to know.
#
# Idempotent: a port already free is left untouched, so restarting the same
# worktree's stack keeps the same URLs across runs. Only a port that's
# actually occupied gets bumped to the next free one.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

ENV_FILE=.env
[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"

# True (exit 0) if something is already listening on 127.0.0.1:$1.
port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# Prints the first free port at or after $1.
find_free_port() {
  local port=$1
  while port_in_use "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

# Reads a key's current value from .env, falling back to $2 if the key is
# absent (a freshly-copied .env.example already has it, but don't assume).
get_env_var() {
  local key=$1 default=$2
  local line
  line=$(grep -m1 "^${key}=" "$ENV_FILE" || true)
  if [ -n "$line" ]; then echo "${line#"${key}="}"; else echo "$default"; fi
}

# Sets (or appends) key=value in .env. `|` as sed's delimiter since every
# value here is a URL full of `/`.
set_env_var() {
  local key=$1 value=$2
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

editor_default=5173
api_default=8787
pg_default=5432

editor_port=$(get_env_var PREFAB_EDITOR_HOST_PORT "$editor_default")
api_port=$(get_env_var PREFAB_API_HOST_PORT "$api_default")
pg_port=$(get_env_var PREFAB_POSTGRES_PORT "$pg_default")

new_editor_port=$(find_free_port "$editor_port")
new_api_port=$(find_free_port "$api_port")
new_pg_port=$(find_free_port "$pg_port")

[ "$new_editor_port" != "$editor_port" ] && echo "PREFAB_EDITOR_HOST_PORT $editor_port is taken — using $new_editor_port instead"
[ "$new_api_port" != "$api_port" ] && echo "PREFAB_API_HOST_PORT $api_port is taken — using $new_api_port instead"
[ "$new_pg_port" != "$pg_port" ] && echo "PREFAB_POSTGRES_PORT $pg_port is taken — using $new_pg_port instead"

set_env_var PREFAB_EDITOR_HOST_PORT "$new_editor_port"
set_env_var PREFAB_API_HOST_PORT "$new_api_port"
set_env_var PREFAB_POSTGRES_PORT "$new_pg_port"

# Host-facing URLs that reference the API's *host* port directly (never the
# in-container one) — kept in sync so the browser, a natively-run CLI/MCP,
# and the published-site runtime all still point at wherever the API
# actually landed. VITE_PREFAB_API_URL is unset/empty in the Docker path
# (the editor talks to the API same-origin, through its own dev-server
# proxy) but is rewritten too for the native dev path's sake.
if [ "$new_api_port" != "$api_port" ]; then
  for key in RUNTIME_API_URL PREFAB_API_URL VITE_PREFAB_API_URL; do
    set_env_var "$key" "http://localhost:${new_api_port}"
  done
fi

# Same reasoning for Postgres — only the native path (a host-side
# `pnpm run db:migrate`/psql, outside Docker) ever reads these from .env;
# migrate/api's own Docker Compose environment overrides them with the
# internal postgres:5432 address regardless.
if [ "$new_pg_port" != "$pg_port" ]; then
  for key in MIGRATE_DATABASE_URL MIGRATE_DATABASE_URL_TEST DATABASE_URL DATABASE_URL_TEST; do
    current=$(get_env_var "$key" "")
    [ -n "$current" ] && set_env_var "$key" "${current/localhost:${pg_port}/localhost:${new_pg_port}}"
  done
fi

if [ -f docker-compose.override.yml ]; then
  editor_url="http://pre-fab.localhost/ (via Traefik)"
else
  editor_url="http://localhost:${new_editor_port}"
fi

cat <<EOF
Editor:   ${editor_url}
API:      http://localhost:${new_api_port}
Postgres: localhost:${new_pg_port}
EOF
