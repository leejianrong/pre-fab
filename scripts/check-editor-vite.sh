#!/usr/bin/env bash
# KAN-1266: sanity-checks apps/editor/node_modules/vite before the editor
# dev server starts, run as part of docker-compose.yml's `editor` service
# command (after `pnpm install`, before `vite` itself).
#
# A cached Docker volume (node_modules_editor/node_modules_root/pnpm-store)
# that predates a dependency version bump on main can leave
# node_modules/vite a dangling symlink into a stale
# node_modules/.pnpm/vite@<old-version>/ path that a frozen-lockfile
# `pnpm install` doesn't repair. Vite then keeps running off an
# already-deleted-but-open file handle: `docker logs`/`curl` look
# completely healthy (curl gets Vite's SPA-fallback index.html for any
# path — a false-positive 200) while a real browser 404s on /@vite/client
# and gets a permanently blank page — only a real `<script>` fetch (a
# different Sec-Fetch-Dest than curl sends) exposes it. The known-good
# workaround is `make nuke && make up` (wipes the stale volumes); this
# script exists so a stale volume fails loudly here instead of shipping a
# silent blank page.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../apps/editor"

vite_bin=node_modules/vite/bin/vite.js

# `test -e` follows symlinks, so this is false both when the entry is
# altogether missing and when it's a symlink whose target no longer
# exists (the dangling-symlink case this check exists for) — exactly the
# two cases curl/docker-logs can't distinguish from "working".
if [ ! -e "$vite_bin" ]; then
  {
    echo "=============================================================="
    echo "ERROR: apps/editor/${vite_bin} is missing or a dangling symlink."
    echo
    echo "This usually means a cached Docker volume (node_modules_editor,"
    echo "node_modules_root, or pnpm-store) predates a dependency version"
    echo "bump on main, so node_modules/vite still points at a pnpm store"
    echo "path that no longer exists. If this check is skipped, Vite"
    echo "keeps running off an already-deleted file handle: curl and"
    echo "docker logs look healthy, but a real browser gets a permanently"
    echo "blank page (404 on /@vite/client)."
    echo
    echo "Fix: from the repo root, run 'make nuke && make up' to wipe the"
    echo "stale volumes and reinstall clean."
    echo "=============================================================="
  } >&2
  exit 1
fi
