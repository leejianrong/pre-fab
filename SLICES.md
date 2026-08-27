# pre-fab — SLICES

Vertical increments for milestone 1. Each ends in something demonstrable to a
person who has not read the code. Decisions are cited as ADR-NNNN; requirements
as RN, defined in `PLAN.md`.

Where a slice rests on an `ASSUMED` default rather than a decided fork, it is
marked **[ASSUMED]** inline, so it is obvious what could move.

**Sequencing principle**: slice 1 confronts the mechanism the product lives or
dies on, not the easiest one to build.

| # | Slice | Confronts |
|---|---|---|
| 1 | One block, four surfaces | The core trinity: one write path, WYSIWYG parity, portability |
| — | *(identity is folded into slice 1, not a slice of its own — it has no demo)* | |
| 2 | Block library and theme tokens | Whether token-only blocks can produce good-looking pages |
| 3 | Templates and onboarding | R1's 10-minute claim |
| 4 | Custom domains and TLS | The hard operational problem |
| 5 | Blog and collections | Layout/content separation |
| 6 | Forms and submissions | The first dynamic runtime |
| 7 | Self-host runtime and eject | The differentiator, proven |
| 8 | Accounts, plans and billing | Becoming a business |
| 9 | Scheduling and bookings | The algorithmically hardest code |

---

## Slice 1 — One block, four surfaces

**Demo.** Edit a heading in the browser. Run `prefab pull` and see the change in
a file. Edit the file, `prefab push`, watch the canvas update. Ask an agent over
MCP to change it again. Publish. The live URL updates. Export the site, re-import
it, and the diff is empty.

**Why first.** Everything pre-fab claims over Wix and Squarespace lives in this
one loop: one write path (ADR-0003), a canvas that renders what publishes, and a
document that survives leaving. If Puck's model fights our schema (ADR-0004), or
the round-trip cannot be made byte-identical (ADR-0002), this is the slice where
we find out — while the fallback is still cheap.

### Build
- Document schema package: flat ULID-keyed blocks, `parent` + `order`,
  `schemaVersion`, one block type (`Hero`), Zod validation, migration harness.
- **Minimal identity**: account and session tables, one owner per site, and
  per-site scoped, expiring, revocable API tokens for the CLI and MCP (ADR-0001,
  ADR-0003). No signup UI, no email verification, no roles — accounts are seeded.
  This exists in slice 1 because RLS needs an authenticated principal to set
  tenant context, and the CLI and MCP need a credential to reach the API at all.
  Slice 3 puts a signup flow on top; slice 8 adds roles and billing.
- Postgres with RLS (ADR-0008), sites/pages/blocks/publishes tables, tenant
  context set per transaction from the authenticated principal.
- HTTP API with the full mutation set for one block type, optimistic version
  check returning a diff on conflict (ADR-0006).
- Editor: Puck canvas adapted to our schema — Puck is a dependency of the editor
  package only, and neither renderer nor runtime imports it (ADR-0004).
- CLI: `pull`, `push`, `diff`, `publish`, `export`, `import`, `preview`, all with
  `--json` and the exit-code contract (R13).
- MCP server as a thin adapter over the CLI command layer, plus `site outline`
  (R14) and screenshot preview (R15).
- Publish pipeline: Astro build **[ASSUMED — Astro as the renderer]**, immutable
  content-addressed bundle, pointer swap, serve on a `*.prefab.app` subdomain.
- Publish history and one-action rollback to any previous bundle (R5). Cheap
  here because bundles are immutable and going live is a pointer swap — and far
  more expensive to add once anything depends on publish behaviour.
- Local build and preview against a checkout with no network access (R16).
- CI: the parity conformance test (R12), the round-trip test (R8), and the import
  containment checks — nothing outside the publish pipeline may import Astro
  (ADR-0007), and block components may not import Puck context (ADR-0004).
- Lint rule enforcing that block components are SSR-safe: no browser-only APIs
  outside effects.

### Tests

#### End-to-end
- Editing the Hero heading in the canvas, publishing, and loading the live URL
  shows the new text.
- `prefab pull`, edit the file, `prefab push` — the canvas shows the change on
  reload.
- The same mutation performed via API, CLI and MCP produces byte-identical
  documents.
- The Hero block renders identically in the Puck canvas and in the published
  output — the concrete form of the WYSIWYG guarantee, and the test that would
  catch a block reaching for Puck context or a browser-only API (ADR-0004).
- `export → import → export` produces byte-identical output (R8).
- A write with a stale base version is rejected with exit code 2 and a diff, and
  the earlier write survives intact (R17).
- A failed publish leaves the previously live site byte-identical (R4).
- Publishing twice, then restoring the first publish in one action, serves the
  original content within 10 s (R5).
- With the network blocked, `prefab build` and `prefab preview` succeed against a
  local checkout, and `prefab push` fails with exit code 4 rather than hanging
  (R16).
- A patch containing one valid and one invalid block change applies neither, and
  the document is unchanged afterwards (R18).
- Save round-trips within 400 ms p95 against a seeded page (R2).

#### Integration
- API against real Postgres with RLS active: a cross-tenant read fails.
- Publish writes a bundle to real object storage and swaps the pointer atomically.
- The import containment checks fail the build when a block package imports Astro
  or Puck context.
- MCP tool invocation reaches the same handler as the equivalent CLI command.

#### Unit
- Schema validation rejects unknown fields and names the block id and field path
  (R18).
- Flat-tree operations: insert, move, reparent, reorder — ULIDs preserved
  throughout.
- Diff engine output for add, remove, move and field-change.

---

## Slice 2 — Block library and theme tokens

**Demo.** Build a credible one-page site from a dozen blocks, then change the
theme and watch the whole page restyle without touching a block.

**Why here.** Slice 1 proved the loop with one block. This proves the constraint
that makes templates possible at all: blocks reference tokens, never raw values
(ADR-0002). If good-looking pages cannot be built under that constraint, we learn
it before eight templates are authored against it.

### Build
- Twelve to fifteen first-party blocks: hero, heading, rich text, image, gallery,
  columns, spacer, button, card grid, testimonial, FAQ, contact details, map
  embed, footer, nav.
- `theme.json`: colour, type scale, spacing, radii. Theme editor UI.
- Responsive rules: automatic per-block behaviour with overrides at three
  breakpoints **[ASSUMED — three breakpoints, no free-form positioning]**.
- Raw-HTML embed block, rendered in a sandboxed iframe **[ASSUMED — no
  tenant-authored JS on the site origin]**.
- Per-block migration chain and versioning.
- Asset upload: content-addressed by sha256, R2 storage, responsive image
  generation.

### Tests

#### End-to-end
- A page assembled from every block type publishes and renders correctly at all
  three breakpoints.
- Switching theme restyles every block with no document mutation.
- An unknown block type in a document shows a placeholder in the editor, is
  skipped on publish, and is still present after export (R19).
- On a page of 40 mixed blocks, drag and reorder give visual feedback within
  100 ms p95 (R2). Measured here rather than in slice 1 because a one-block page
  cannot fail this.

#### Integration
- Asset upload deduplicates identical files by hash.
- Responsive image variants are generated and referenced correctly.
- Raw-HTML block content cannot execute script on the parent origin.

#### Unit
- Token resolution, including fallback when a token is missing.
- Per-breakpoint override precedence.
- Every block's migration chain, from every prior version to current.

---

## Slice 3 — Templates and onboarding

**Demo.** A stranger signs up, picks a template, changes the business name and
photo, and publishes — in under ten minutes, unassisted.

**Why here.** This is R1, the acceptance test for ADR-0001's beachhead bet. It is
also the first slice where the product is judged on whether it looks good rather
than whether it works.

### Build
- Eight templates authored as exported site trees **[ASSUMED — eight, covering
  consultant, photographer, tutor, café, fitness coach, small agency, event,
  personal brand]**. Authoring them through the export format dogfoods ADR-0002.
- Template gallery and fork-on-use instantiation (ADR-0011 — templates are seeds
  and do not receive upstream updates).
- Signup, email verification and first-run flow, built on slice 1's identity
  primitive rather than replacing it.
- Guided first edit and a publish celebration moment.
- Lighthouse and axe-core budgets in CI, per template (R3, R6).

### Tests

#### End-to-end
- Five unassisted first-time users reach a published site in under 10 minutes
  (R1). Recorded sessions, not a synthetic timer.
- Every template publishes with Lighthouse performance ≥ 90 and LCP < 1.5 s p75
  on simulated 4G (R3).
- Every template passes axe-core with zero criticals and WCAG 2.2 AA contrast
  (R6).
- Forking a template twice yields two independent sites; editing one does not
  affect the other.

#### Integration
- Template instantiation assigns fresh ULIDs and copies assets by reference.
- Signup provisions a site row with correct RLS scoping.

#### Unit
- Template manifest validation.
- ULID re-keying on fork preserves the internal reference graph.

---

## Slice 4 — Custom domains and TLS

**Demo.** Point your own domain at a pre-fab site and it serves over HTTPS with a
valid certificate, with a DNS walkthrough that a non-technical owner can follow.

**Why here.** Operationally the hardest thing in this product class, and the first
paid gate (ADR-0012), so it must work before anyone is charged. Isolated into its
own slice because certificate provisioning has failure modes that deserve their
own attention.

### Build
- Cloudflare SSL for SaaS integration: custom hostname registration, certificate
  provisioning, renewal **[ASSUMED — Cloudflare as the hosting platform,
  ADR-0007]**.
- DNS verification polling with clear pending/failed/active states.
- Plain-English setup guides for the common registrars.
- Apex and `www` handling, and redirect configuration.
- Domain status surfaced in the dashboard, with actionable errors.

### Tests

#### End-to-end
- Adding a domain, setting the CNAME, and reaching an active certificate serves
  the site over HTTPS.
- A misconfigured DNS record produces a specific, actionable error rather than a
  generic failure.
- Removing a domain deprovisions the certificate and stops serving.

#### Integration
- Certificate provisioning against the Cloudflare API, including the renewal path.
- Verification polling handles slow DNS propagation without false failure.

#### Unit
- DNS record validation and normalisation.
- Apex-versus-subdomain detection.

---

## Slice 5 — Blog and collections

**Demo.** Write a post in the editor, publish it, see it on an index page with an
RSS feed — then edit the same post as a file via `prefab pull`.

**Why here.** First exercise of layout/content separation **[ASSUMED — long-form
content in separate documents from the block tree]**. It is also the cheapest
place to prove that content-heavy sites publish within R4's budget.

### Build
- Collection schema: posts with title, slug, date, author, tags, body, cover.
- Rich-text editing for long-form content, with a file representation that is
  pleasant to edit by hand.
- List and detail block types with pagination.
- RSS and sitemap generation.
- Locale key on content records, unused in milestone 1 but present so
  multilingual is not a migration later.
- Draft versus published state per post.

### Tests

#### End-to-end
- Creating, publishing and reading a post through the editor, then editing the
  same post as a file and pushing it back.
- A 50-post site publishes within 10 s p95, and a 500-post site within 90 s p95
  (R4). The second number exists because Astro full-rebuilds; breaching it is the
  documented trigger for ADR-0007's incremental-renderer escape hatch, and this
  slice is where publish time is first profiled against page count.
- RSS validates and the sitemap lists every published post.
- A scheduled or draft post is not reachable on the live site.

#### Integration
- Collection queries under RLS, including pagination boundaries.
- Publish includes only published posts.

#### Unit
- Slug generation and collision handling.
- Rich-text to file-format round-trip fidelity.

---

## Slice 6 — Forms and submissions

**Demo.** A visitor submits a contact form on a published site. The owner gets an
email, sees the submission in their dashboard, exports it as CSV, and a webhook
fires.

**Why here.** The first dynamic behaviour, so it is where the runtime API is
born (ADR-0007). That API's shape is what slice 7 has to reimplement, so it is
designed here with that constraint explicit.

### Build
- Form block with a field builder: text, email, textarea, select, checkbox, file.
- **The runtime API**, deliberately minimal, in packages structurally separate
  from the control plane.
- **The CI separability check**: a runtime package importing a control-plane
  package fails the build (ADR-0010).
- Submission storage in platform Postgres, never in the site source tree (R20).
- Notification email **[ASSUMED — Resend or Postmark behind a one-interface
  adapter]**.
- Turnstile and per-IP, per-site rate limiting.
- CSV/JSON export, per-record deletion for PDPA/GDPR.
- Webhook delivery on submission with retry.

### Tests

#### End-to-end
- Submitting a form on a published static page stores the record, emails the
  owner, and fires the webhook.
- Submissions export as CSV and a single record can be deleted.
- A form on a page with the email provider unavailable still stores the
  submission and surfaces the failure in the dashboard (R7.4 behaviour).
- The site source tree contains no submission data after export (R20).

#### Integration
- Runtime API against real Postgres with RLS.
- Webhook retry and backoff against a failing endpoint.
- Turnstile verification against the provider sandbox.

#### Unit
- Field validation per type.
- Rate-limit accounting.
- CSV escaping, including fields containing delimiters and newlines.

---

## Slice 7 — Self-host runtime and eject

**Demo.** Export a site with a working contact form. Run it on a laptop with no
connection to pre-fab. Submit the form. It works. Then eject the same site to an
Astro project and `npm run build` it.

**Why here.** The differentiator, and it can only be proven once something dynamic
exists — before slice 6 the static bundle *was* the whole self-host story. The
separability seam has been enforced by CI since slice 6, so this slice assembles
rather than disentangles.

### Build
- Self-host runtime package: serves the bundle, implements the runtime API,
  SQLite or Postgres for submissions, Apache-2.0 licensed (ADR-0010).
- Docker image and a documented single-command start.
- Export tier (a): static bundle with a manifest declaring schema version and
  supported import range.
- Export tier (c): Astro project generation, no pre-fab runtime dependency (R11).
- Screenshot-diff fidelity harness (R9).
- Self-host documentation covering configuration, backups and upgrades.

### Tests

#### End-to-end
- An exported self-host runtime serves the site and accepts a form submission
  with all pre-fab infrastructure unreachable (R10).
- An ejected project builds and runs with `npm install && npm run build`, with no
  pre-fab package present at runtime (R11).
- Exported output renders within 0.1 % pixel delta of the hosted site across
  every first-party block (R9).
- Export is available and completes on a free-tier account (R7).

#### Integration
- The CI separability check fails when a runtime package imports a control-plane
  package.
- An export from a two-versions-old schema imports successfully.

#### Unit
- Export manifest generation and version-range logic.
- Astro project scaffolding from a document tree.

---

## Slice 8 — Accounts, plans and billing

**Demo.** Sign up free, hit the custom-domain gate, upgrade, and the gate opens.

**Why here.** Low technical risk, so it sits late — but it must precede launch,
and the free-tier gate depends on slice 4's domains existing.

### Build
- Stripe subscriptions for **our** plans. Kept explicitly distinct in code from
  the tenant's own Stripe under ADR-0005 — different concern, different
  credentials, different lifecycle.
- Plan definitions and gate enforcement, custom domain being the first gate
  **[ASSUMED — free tier on a `*.prefab.app` subdomain with a badge]**.
- Invited editors with owner/editor/viewer roles.
- Cancellation flow with an explicit export prompt, and the 30-day post-
  cancellation retention window.
- Subscription webhook handling: payment failure, dunning, reactivation.

### Tests

#### End-to-end
- A free account is blocked from adding a custom domain, upgrades, and succeeds.
- Cancelling prompts export, retains data for 30 days, then stops serving.
- A failed payment moves the account to a grace state without taking sites down
  immediately.
- Export still works on a cancelled account inside the retention window (R7).

#### Integration
- Stripe subscription webhooks against the Stripe sandbox.
- Role enforcement under RLS for each of owner, editor, viewer.

#### Unit
- Plan gate evaluation.
- Retention-window date arithmetic across timezones.

---

## Slice 9 — Scheduling and bookings

**Demo.** Publish a booking page. A visitor picks a slot in their own timezone.
Both parties get a calendar invite, and the owner's Google Calendar shows it.

**Why here.** Last because it is the largest self-contained build (ADR-0009 —
built, not bought, because Cal.com is AGPLv3) and because it depends on slice 6's
runtime API already existing and being stable.

### Build
- Availability rules: weekly recurring windows, date overrides, buffers, minimum
  notice, maximum booking horizon **[ASSUMED — build the booking core rather than
  integrate, ADR-0009]**.
- Slot computation: rules minus existing bookings minus synced busy time.
- Booking block with timezone-aware slot picker.
- Confirmation email with ICS attachment; cancel and reschedule links.
- Two-way sync with Google Calendar and Microsoft 365.
- Runtime API extension for booking create, cancel, reschedule — kept within the
  separability constraint so the self-host runtime keeps bookings working.

### Tests

#### End-to-end
- A visitor in a different timezone books a slot; both parties receive a correct
  invite and the owner's external calendar reflects it.
- Double-booking the same slot concurrently: one succeeds, one is rejected
  cleanly.
- Cancelling releases the slot and updates the external calendar.
- Bookings continue to work in the exported self-host runtime (R10).
- A booking spanning a DST transition shows the correct local time to both
  parties.

#### Integration
- Google Calendar and Microsoft 365 sync against provider sandboxes, including
  token refresh.
- Calendar provider unavailable: the page still renders, the widget degrades to
  an explicit error, and the dashboard surfaces the failure.

#### Unit
- Slot computation across every rule combination: buffers, overrides, minimum
  notice, horizon.
- DST boundary arithmetic in both directions.
- ICS generation validity.

---

## After milestone 1

Payments blocks and event sign-ups (milestone 2, additive on ADR-0005 and the
runtime API), then the third-party block contract stabilising toward ADR-0011's
deferred ecosystem, then ADR-0013's Go extractions if the profile or the
self-host story calls for them.
