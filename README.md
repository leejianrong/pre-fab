# pre-fab

A no-code website builder where the site is a portable, diffable artifact the
customer owns. See `PLAN.md` for the problem and requirements (`R1`-`R20`),
`docs/adr/` for binding decisions, and `SLICES.md` for the build sequence.

|                                                    |                                                  |
| -------------------------------------------------- | ------------------------------------------------ |
| ![Editor canvas](docs/screenshots/editor-canvas.png) | ![Blog panel](docs/screenshots/blog-panel.png) |
| ![Published blog index](docs/screenshots/blog-list.png) | ![Published post](docs/screenshots/blog-post.png) |

*Top row: the Puck canvas editing a forked template, and the blog admin
panel. Bottom row: the published blog index and a published post, both
rendered by the real static publish pipeline, not mockups.*

**Status: milestone 1 complete (slices 1-9).** The editor and block library,
theme tokens, templates and onboarding, custom domains with TLS, blog and
collections, forms and submissions, self-host and eject, billing, and
scheduling and bookings all work end to end. `SLICES.md` has the build log
for each slice; `docs/adr/` has the decisions behind them.

One caveat runs across most of that list: several third-party integrations
(Cloudflare, Stripe, Resend, Turnstile, Google Calendar, Microsoft 365) only
ever run against an in-memory fake provider here, because no live account
for any of them exists in this environment. The real adapters are written
from each provider's public docs, but none has been exercised against a
live account. Treat them as informed drafts, not verified integrations,
until someone runs them for real.

## Monorepo layout

```text
apps/
  api/          HTTP API - the one write path (mutations, auth, publish)
  cli/          prefab CLI, wraps packages/commands
  mcp/          MCP server (stdio), wraps packages/commands
  editor/       Puck canvas SPA (Vite + React 19)
  self-host/    Apache-2.0 runtime that serves an exported bundle and
                reimplements the runtime API against SQLite
packages/
  schema/       document model: ULIDs, Zod validation, flat block tree,
                diff, and posts' frontmatter+Markdown file format
  blocks/       first-party block components, SSR-safe, no Puck import
  puck-adapter/ translates the flat schema to and from Puck's shape
  db/           Postgres access and migrations, RLS keyed on site_id
  api-client/   typed HTTP client shared by the CLI, MCP server and editor
  publish/      Astro build pipeline: content-addressed bundles, atomic
                pointer swap, RSS/sitemap generation, and the eject
                generator for a standalone Astro project
  commands/     one command registry the CLI and MCP server both wrap
  templates/    the site templates, authored as exported site trees
  runtime/      the runtime API's storage-agnostic logic: form and
                booking validation, rate limiting, webhook backoff, slot
                computation, timezone conversion, ICS generation. Zero
                dependency on any control-plane package.
tools/
  checks/       CI containment, parity, per-template budget, and
                eject-vs-hosted fidelity checks
e2e/            Playwright acceptance tests, one per SLICES.md scenario
scripts/        local Postgres setup
```

Package boundaries are load-bearing, not aesthetic. Three of them are
enforced by CI (`pnpm run ci:containment`, `pnpm run ci:parity`):

1. Nothing outside `packages/publish` imports Astro.
2. `packages/blocks` never imports Puck context, and never touches a
   browser-only global outside a `useEffect`.
3. Every mutation in `apps/api/src/mutations.ts` has a matching command in
   `packages/commands`, wired into `apps/cli/src/main.ts`, so the CLI and
   MCP server can never drift out of parity with the API.
4. `packages/runtime` and `apps/self-host` never import a control-plane
   package (`@prefab/db`, `@prefab/api-client`, `@prefab/commands`,
   `@prefab/blocks`, `@prefab/publish`, `@prefab/puck-adapter`).
   `apps/self-host` reimplements `packages/runtime`'s storage interfaces
   against SQLite, and `submitForm` itself runs unchanged against them.

## Prerequisites

- Node 22+
- pnpm 10 (`corepack enable` picks up the pinned version from `package.json`)
- Docker with Compose v2, for `make dev` (below) — or, to run everything
  natively instead, a local Postgres 16 with `sudo` access for
  `scripts/db-up.sh` (it starts the cluster and creates the `prefab`
  roles/databases; see that script and `scripts/db-init.sql` for exactly
  what it does)

## Local setup

```bash
make dev
```

That's it: it copies `.env.example` to `.env` on first run, then brings up
Postgres, runs migrations, and starts `apps/api` and `apps/editor` together
in Docker Compose, hot-reloading on file changes. Open the editor at
**`http://localhost:5173`**. `make up` does the same thing detached; `make
down` stops it, `make nuke` also wipes the Postgres volume and the pnpm
store cache. See `make help`-worthy targets in the `Makefile` (`test`,
`test-integration`, `ci`, `logs`).

`5173` (the editor), `8787` (the API, also still published directly for the
CLI/MCP below) and `5432` (Postgres) never need manual attention:
`scripts/dev-ports.sh` runs automatically before `up`/`dev` (also on its own
as `make ports`), checks each one, and rewrites `.env` to the next free port
if something else already has it — printing the resulting URLs either way.
Safe by construction: every inter-container hop (editor → api, api/migrate →
postgres) already goes over Docker's internal network by service name, never
through these host ports, so reassigning one only ever affects host-side
consumers (your browser, a natively-run CLI/MCP), which the script keeps in
sync in `.env` at the same time. A port that's already free is left alone,
so re-running `make dev` in the same worktree keeps the same URLs.

Running several projects' dev stacks on this laptop and want one stable
hostname per project instead of juggling ports? Copy
`docker-compose.override.yml.example` to `docker-compose.override.yml`
(gitignored, loaded automatically) to route the editor through a
machine-wide Traefik instance at **`http://pre-fab.localhost/`** instead —
see that file for what it needs (a `proxy` external Docker network and a
Traefik container watching the Docker socket, both one-time, machine-level
setup outside this repo). `*.localhost` needs no `/etc/hosts` entry —
modern browsers treat it as loopback per RFC 6761. Nothing here is
required: the plain `http://localhost:5173` path above always works with
no override present, including in CI.

Prefer running natively instead of in Docker? `pnpm install`, then
`pnpm run dev:db` (starts a system Postgres via `sudo pg_ctlcluster`/
`service postgresql start` and `scripts/db-init.sql` — requires a local
Postgres 16 install and `sudo`) and `pnpm run db:migrate`, then the two dev
servers from "Running the pieces" below in separate terminals.

`.env.example` documents every variable. The essentials:

- `MIGRATE_DATABASE_URL(_TEST)` - the schema-owning role, used only by migrations.
- `DATABASE_URL(_TEST)` - the non-owner `prefab_app` role apps/api runs as, so RLS applies unconditionally.
- `EDITOR_ORIGIN`, `VITE_PREFAB_API_URL` - matching origins for apps/api and apps/editor (the editor's dev server proxies `/v1` to the API so browser requests stay same-origin).
- `PREFAB_API_URL`, `PREFAB_TOKEN` - used by the CLI and MCP server.

Everything else configures an optional third-party integration, and every
one of them defaults to an in-memory fake provider, including in CI, when
its variables are unset:

- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID` - custom domains via Cloudflare SSL for SaaS.
- `RUNTIME_API_URL`, `RESEND_API_KEY`/`RESEND_FROM_ADDRESS`, `TURNSTILE_SECRET_KEY`/`TURNSTILE_SITE_KEY` - where a published site's Form island submits to, plus its email and spam-check providers.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO` - our own plan billing, never a tenant's own Stripe account.
- `GOOGLE_CALENDAR_CLIENT_ID`/`_SECRET` and `MICROSOFT_CALENDAR_CLIENT_ID`/`_SECRET`/`_TENANT` - two-way calendar sync for bookings.

### Running the pieces natively

Only needed for the native path above — `make dev` already runs api and
editor for you.

```bash
pnpm --filter @prefab/api run dev        # HTTP API on :8787
pnpm --filter @prefab/editor run dev     # Puck canvas on :5173 (proxies to the API)
pnpm --filter @prefab/cli run start -- --help
pnpm --filter @prefab/mcp run start      # stdio MCP server; needs PREFAB_TOKEN
```

## Usage

Open the editor at `http://localhost:5173` (either `make dev` or running
natively) — dev-login with any seeded email (or sign up for real and read
the verification code back from
`GET /v1/dev/emails?to=<email>`, the dev-only stand-in for an inbox), then
pick a template or start blank.

The same round trip works from the CLI:

```bash
prefab signup <email> && prefab verify <email> <code>
prefab template use <templateId> <slug> <name>
prefab pull            # checks out pages/*.json, and posts/*.md once you have any
# edit pages/*.json by hand, or in the Puck canvas
prefab push
prefab publish
```

Every site is reachable at `<slug>.<PUBLIC_SITE_HOST>` as soon as it's
published; `prefab domain add <siteId> <hostname>` layers a custom one on
top. Everything else editable in the canvas has a matching CLI surface:
`prefab post create`, `prefab form configure`, `prefab availability set`,
`prefab booking list`, and so on. Run `prefab --help` for the full command
tree.

Export is free on every plan: `prefab export-bundle` produces a
self-contained static bundle, `prefab eject` a standalone Astro project
with no `@prefab/*` dependency. See "Self-hosting a site" below.

## Self-hosting a site

A different Docker image from the one `make dev` uses above: this one is
what a *customer* runs to serve their own exported site, with zero
connection to pre-fab. `apps/self-host` serves an exported bundle and keeps
its forms and bookings working:

```bash
prefab export-bundle <siteId> ./site --runtime-api-url http://localhost:8080
cd apps/self-host
BUNDLE_DIR=../../site DATA_DIR=./data npm run start
```

See `apps/self-host/README.md` for configuration, Docker, backups and
upgrades.

## Tests

```bash
pnpm run test:unit          # per-package, no external services
pnpm run test:integration   # per-package, against real Postgres (dev:db first)
pnpm run test:e2e           # Playwright, spins up its own api+editor+DB
pnpm run ci                 # lint + typecheck + containment + unit + parity
pnpm run ci:budgets         # per-template Lighthouse + axe-core budgets
pnpm run ci:fidelity        # hosted-vs-ejected pixel delta, per block
```

Integration and e2e tests run against real Postgres and a real Astro
build. Nothing here is mocked at the boundary CI actually cares about.

## CI

`.github/workflows/ci.yml` runs eight jobs on every push and PR: a
gitleaks secret scan over the full history, lint and typecheck, the
containment and parity checks above, unit tests, integration tests
(a real Postgres 16 service container), per-template Lighthouse and
axe-core budgets, the eject-vs-hosted fidelity check (its own job, since
it needs a real `npm install` of the ejected project), and the Playwright
e2e suite.

A pre-push git hook (`simple-git-hooks`, installed automatically by
`pnpm install`) mirrors lint, typecheck and unit tests locally before
every push. `SKIP_SIMPLE_GIT_HOOKS=1 git push` bypasses it for the rare
scoped exception. Dependabot proposes dependency updates, npm and GitHub
Actions both, on a weekly schedule.

## Contributing

Work on a branch off `main` and open a PR once `pnpm run ci` is green; see
`CLAUDE.md` for the full conventions (requirement/ADR citation, the
subagent worktree rules, the invariants CI enforces).

## License

Apache License 2.0. See `LICENSE`.
