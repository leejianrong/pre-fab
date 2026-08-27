# pre-fab

A no-code website builder where the site is a portable, diffable artifact the
customer owns. See `PLAN.md` for the problem and requirements (`R1`–`R20`),
`docs/adr/` for binding decisions, and `SLICES.md` for the build sequence.

**Status: Slice 1 ("one block, four surfaces") is built.** A site with a
single Hero block can be created, edited in a Puck canvas, edited by
CLI/MCP/pull-push round trip, and published to a live, rollback-able bundle
— through the same one write path (the HTTP API) every time.

## Monorepo layout

```
apps/
  api/            HTTP API — the one write path (mutations, auth, publish)
  cli/            prefab CLI — commander, wraps packages/commands
  mcp/             MCP server — stdio, wraps packages/commands
  editor/         Puck canvas SPA (Vite + React 19)
packages/
  schema/          document model: ULIDs, Zod validation, flat block tree, diff
  blocks/          block components (Hero only in slice 1) — SSR-safe, no Puck import
  puck-adapter/    translates the flat schema <-> Puck's content/zones shape
  db/              Postgres access + migrations, RLS keyed on site_id
  api-client/      typed HTTP client shared by the CLI, MCP server and editor
  publish/         Astro build pipeline — content-addressed bundles, atomic pointer swap
  commands/        one command registry the CLI and MCP server both wrap (R12 parity)
tools/
  checks/          CI containment + parity checks (AST-based, not just lint rules)
e2e/               Playwright acceptance tests, one per SLICES.md scenario
scripts/           local Postgres setup
```

Package boundaries are load-bearing, not aesthetic — three of them are
enforced by CI (`pnpm run ci:containment`, `pnpm run ci:parity`):

1. Nothing outside `packages/publish` imports Astro.
2. `packages/blocks` never imports Puck context, and never touches a
   browser-only global outside a `useEffect`.
3. Every mutation registered in `apps/api/src/mutations.ts` has a matching
   command in `packages/commands`, and every command is wired into
   `apps/cli/src/main.ts` — so the CLI and MCP server can never drift out of
   parity with the API.

## Prerequisites

- Node 22+
- pnpm 10 (`corepack enable` will pick up the pinned version from `package.json`)
- A local Postgres 16 with `sudo` access for `scripts/db-up.sh` (it starts the
  cluster and creates the `prefab` roles/databases; see that script and
  `scripts/db-init.sql` for exactly what it does)

## Local setup

```bash
pnpm install
cp .env.example .env        # then fill in each app's .env as noted below
pnpm run dev:db              # starts Postgres, creates prefab/prefab_app roles + dev/test/e2e DBs
pnpm run db:migrate          # runs packages/db/migrations against prefab_dev
```

`.env.example` documents every variable; the short version:

- `MIGRATE_DATABASE_URL(_TEST)` — the schema-owning role, used only by migrations.
- `DATABASE_URL(_TEST)` — the non-owner `prefab_app` role apps/api runs as, so
  RLS applies unconditionally (ADR-0008).
- `EDITOR_ORIGIN`, `VITE_PREFAB_API_URL` — apps/api and apps/editor need matching
  origins; the editor's Vite dev server also proxies `/v1` to the API so
  browser requests stay same-origin (cross-origin cookies are unreliable on
  `localhost` across ports).
- `PREFAB_API_URL`, `PREFAB_TOKEN` — used by the CLI and MCP server.

### Running the pieces

```bash
pnpm --filter @prefab/api run dev        # HTTP API on :8787
pnpm --filter @prefab/editor run dev     # Puck canvas on :5173 (proxies to the API)
pnpm --filter @prefab/cli run start -- --help
pnpm --filter @prefab/mcp run start      # stdio MCP server; needs PREFAB_TOKEN
```

For a first site: open the editor at `http://localhost:5173`, dev-login with
any email, and create a site — it comes with one page and one Hero block.
Or from the CLI: `prefab login`, `prefab site create <slug> <name>`,
`prefab pull`, edit `pages/*.json`, `prefab push`, `prefab publish`.

## Tests

```bash
pnpm run test:unit          # per-package, no external services
pnpm run test:integration   # per-package, against real Postgres (dev:db first)
pnpm run test:e2e           # Playwright, spins up its own api+editor+DB
pnpm run ci                 # lint + typecheck + containment + unit + parity
```

Integration and e2e tests run against real Postgres and a real Astro build —
nothing here is mocked at the boundary CI actually cares about.

## CI

`.github/workflows/ci.yml` runs five jobs on every push/PR: `lint-typecheck`,
`containment-and-parity` (the enforced invariants above), `unit-tests`,
`integration-tests` (Postgres 16 service container), and `e2e` (Postgres 16 +
`playwright install --with-deps chromium`).
