# @prefab/self-host

The Apache-2.0 licensed self-host runtime (ADR-0010, tier b of pre-fab's
three export tiers). It serves an exported static bundle and implements the
runtime API against its own SQLite database, so **forms keep working with
no connection to pre-fab infrastructure** (R10). This is the differentiator
tier: incumbents hand you content, not a working site.

It reimplements exactly the storage interfaces `@prefab/runtime`'s
`submitForm` needs (`FormManifestStore`, `FormSettingsStore`,
`SubmissionStore`, `TurnstileVerifier`, `FormNotifier`, `WebhookQueue`) —
the same function apps/api's hosted runtime API calls, unchanged.

## What it does not do

Editing. The editor, the CLI's mutation commands, templates, billing — all
of that is the hosted product. This package only ever serves a bundle
someone already exported and accepts form submissions against it. To change
the site, edit it in the hosted editor (or a local checkout, per R16) and
re-export.

## Quick start

You need an exported static bundle first (tier a) — from the hosted
product's CLI:

```
prefab export-bundle <siteId> ./site --runtime-api-url http://localhost:8080
```

`--runtime-api-url` must match wherever *this* server will actually be
reachable — it's baked into the bundle's Form island(s) at export time, the
same way `RUNTIME_API_URL` configures the hosted platform
(`.env.example`). Re-export with the real value once you have one (a
domain, a reverse-proxy address).

Then, from this directory:

```
BUNDLE_DIR=../../site DATA_DIR=./data PORT=8080 npm run start
```

Or with Docker, from the repository root:

```
docker build -f apps/self-host/Dockerfile -t prefab-self-host .
docker run -p 8080:8080 \
  -v "$(pwd)/site:/app/site:ro" \
  -v prefab-self-host-data:/app/data \
  prefab-self-host
```

Visit `http://localhost:8080` — the site is live, and its Form block(s)
work.

## Configuration

All configuration is environment variables — no config file, no signup:

| Variable | Default | What |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `BUNDLE_DIR` | `./site` | The exported bundle to serve |
| `DATA_DIR` | `./data` | Where `prefab.db` (SQLite) lives — mount this as a volume |
| `TURNSTILE_SECRET_KEY` | unset | Enables real Cloudflare Turnstile verification for forms that have it turned on. Unset uses a verifier that always succeeds (UNVERIFIED against a live account — same discipline as the hosted platform's own adapter) |
| `RESEND_API_KEY` / `RESEND_FROM_ADDRESS` | unset | Enables real email notifications via Resend (UNVERIFIED against a live account). Unset logs notification emails to stdout instead — visible via `docker logs`, submissions are never lost either way (R7.4) |

### Forms: what's portable, what's local

A form's *definition* (heading, fields, submit label, whether Turnstile is
required) travels inside the exported bundle itself, in
`prefab-forms.json` — this server seeds its `forms` table from that file on
every start, so re-exporting a changed site and restarting is the whole
"redeploy" story for form definitions.

A form's *notification settings* — the owner's email address, a webhook
URL, a webhook secret — never do (R20: no site source tree ever contains a
secret). Configure them directly against this instance's own database:

```
sqlite3 "$DATA_DIR/prefab.db" \
  "INSERT INTO form_settings (form_id, site_id, notify_email, webhook_url, webhook_secret)
   VALUES ('<formId>', '<siteId>', 'owner@example.com', NULL, NULL)
   ON CONFLICT (form_id) DO UPDATE SET notify_email = excluded.notify_email;"
```

`<formId>`/`<siteId>` are the values in `prefab-forms.json`, or
`SELECT id, site_id FROM forms;`.

## Backups

Everything that isn't the bundle itself (submissions, webhook delivery
history, form settings) lives in one file: `$DATA_DIR/prefab.db`. Back it up
like any SQLite file — copy it while the server is stopped, or use
`sqlite3 prefab.db ".backup backup.db"` for an online-safe copy while it's
running. There is no separate secrets store to back up alongside it; the
one exception is a webhook secret you configured directly (see above),
which lives in this same file.

## Upgrades

1. Stop the container.
2. Pull/build the new image.
3. Start it again against the same `DATA_DIR` volume.

The SQLite schema is applied with `CREATE TABLE IF NOT EXISTS` on every
start — additive, no separate migration step, no downtime beyond the
restart itself. To change what's served, export a fresh bundle from the
hosted product and point `BUNDLE_DIR` at it (or rebuild the image with the
new bundle baked in).

## Extractability

Nothing outside `@prefab/runtime` and `@prefab/schema` is imported here
(enforced by this repo's CI containment check — `apps/self-host` is
scanned exactly like `packages/runtime`). Both are pure, dependency-light
packages with no control-plane code in them, so this package is the
concrete answer to "can I really run this with no pre-fab infrastructure":
yes, and CI stops that from silently becoming false.
