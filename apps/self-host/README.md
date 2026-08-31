# @prefab/self-host

The Apache-2.0 licensed self-host runtime (ADR-0010, tier b of pre-fab's
three export tiers). It serves an exported static bundle and implements the
runtime API against its own SQLite database, so **forms and bookings keep
working with no connection to pre-fab infrastructure** (R10). This is the
differentiator tier: incumbents hand you content, not a working site.

It reimplements exactly the storage interfaces `@prefab/runtime`'s
`submitForm` needs (`FormManifestStore`, `FormSettingsStore`,
`SubmissionStore`, `TurnstileVerifier`, `FormNotifier`, `WebhookQueue`) and
Slice 9's booking equivalents (`BookingWidgetStore`, `AvailabilityStore`,
`BookingStore`, `CalendarSyncPort`, `BookingNotifier`) — the same functions
apps/api's hosted runtime API calls, unchanged. One thing is deliberately
*not* reimplemented here: two-way Google/Microsoft 365 calendar sync. A
self-hosted instance has no OAuth callback surface to run it from in this
milestone, so `CalendarSyncPort` here is a no-op (`createNullCalendarSyncPort`)
— local availability rules and bookings work completely unaffected by that
(R10's actual requirement), the site simply never reports synced busy time
or pushes events to an external calendar.

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

Visit `http://localhost:8080` — the site is live, and its Form and Booking
block(s) work.

## Configuration

All configuration is environment variables — no config file, no signup:

| Variable | Default | What |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `BUNDLE_DIR` | `./site` | The exported bundle to serve |
| `DATA_DIR` | `./data` | Where `prefab.db` (SQLite) lives — mount this as a volume |
| `TURNSTILE_SECRET_KEY` | unset | Enables real Cloudflare Turnstile verification for forms that have it turned on. Unset uses a verifier that always succeeds (UNVERIFIED against a live account — same discipline as the hosted platform's own adapter) |
| `RESEND_API_KEY` / `RESEND_FROM_ADDRESS` | unset | Enables real email notifications via Resend (UNVERIFIED against a live account). Unset logs notification emails to stdout instead — visible via `docker logs`, submissions and bookings are never lost either way (R7.4) |
| `BOOKING_OWNER_EMAIL` | unset | Slice 9 — where a new/canceled/rescheduled booking's owner-side copy is emailed. Unset means only the visitor gets notified (no accounts/sessions exist here to resolve an owner's email from automatically, unlike the hosted platform) |

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

### Bookings: what's portable, what's local

A Booking widget's own props (heading, description, button/success text)
travel inside the bundle the same way a Form's field definitions do, in
`prefab-booking-widgets.json` — seeded into `booking_widgets` on every
start. The site's **availability rule** (weekly windows, date overrides,
buffers, minimum notice, maximum horizon) travels too, in
`prefab-availability.json` — a snapshot of whatever `availability.set` was
last called with on the hosted platform, seeded into `availability_rules`
the first time this instance ever starts against a given bundle. After
that first seed it is never overwritten by a later re-export (so a change
you make locally always wins) — edit it directly to update it:

```
sqlite3 "$DATA_DIR/prefab.db" \
  "UPDATE availability_rules SET slot_duration_minutes = 45, min_notice_minutes = 120 WHERE site_id = '<siteId>';"
```

`weekly_windows` and `date_overrides` are stored as JSON text — the same
shape `SetAvailabilityInput` (`packages/api-client`) documents. Bookings
themselves (visitor name/email/notes, the manage-link token) are never
portable at all — visitor PII, R20's platform equivalent — they only ever
exist in `$DATA_DIR/prefab.db`, same as submissions.

## Backups

Everything that isn't the bundle itself (submissions, bookings, availability,
webhook delivery history, form/booking settings) lives in one file:
`$DATA_DIR/prefab.db`. Back it up like any SQLite file — copy it while the
server is stopped, or use `sqlite3 prefab.db ".backup backup.db"` for an
online-safe copy while it's running. There is no separate secrets store to
back up alongside it; the one exception is a webhook secret you configured
directly (see above), which lives in this same file.

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
