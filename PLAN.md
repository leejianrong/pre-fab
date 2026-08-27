# pre-fab — PLAN

> Modular by design. Pretty fabulous by default.

The live planning document. Decisions are cited as ADR-NNNN and live in
`docs/adr/`; the reasoning is there, not restated here. Build sequence is in
`SLICES.md`. Every question asked during planning, answered or deferred, is in
`QUESTIONS.md`.

---

## Problem

A freelancer or small business owner needs a website that does actual work: take
bookings, capture leads, sell a thing, publish a post. Two kinds of tool exist and
neither fits.

**Hosted builders (Wix, Squarespace)** are usable by non-developers, and they
trap the result. The site is not a file you own; it is a row in someone's
database rendered by a proprietary editor. You cannot diff it, cannot script it,
cannot move it, and on the commerce plans you pay a percentage of your own
revenue to the company hosting your HTML. Leaving means rebuilding from scratch.

**Portable stacks (Astro, Next.js and a headless CMS)** give you all of that
ownership and require a developer to set up and a developer to change. The owner
who needed the website cannot edit their own opening hours without a deploy.

The gap is holding all three at once: **no-code, portable, and programmable.**

Agent access is *not* the gap, and it is important to be honest about this. Wix
shipped an MCP server in May 2025 and Squarespace's exposes 67 tools; both are
available as built-in connectors in Claude. An agent can already drive those
products. What it cannot do is hand you the result. The competitors let an agent
operate *their product*. pre-fab lets an agent edit *your artifact*, and the
artifact leaves with you.

## Solution

A subscription website builder where the site is a portable, diffable document.

Non-technical owners get templates, drag-and-drop blocks and a visual editor.
Everything they can do, a CLI and an MCP server can also do — because all three
go through one write path over one document model (ADR-0003). Sites publish as
fast static pages with interactive islands (ADR-0007), and can be exported at any
time, on any plan, for free, in three forms: a static bundle, an
Apache-2.0-licensed self-hostable runtime that keeps forms and bookings working,
or an ejected Astro project (ADR-0010).

Flat subscription pricing. No cut of the customer's revenue — payments go
directly to their own Stripe account and never touch us (ADR-0005, ADR-0012).

### Why anyone switches

| | Wix / Squarespace | Astro + CMS | pre-fab |
|---|---|---|---|
| Usable without a developer | Yes | No | Yes |
| Site is a portable artifact | No | Yes | Yes |
| Scriptable / agent-editable | Their API only | Yes | Yes |
| Keeps working after you leave | No | Yes | Yes (ADR-0010) |
| Takes a cut of your sales | Often | No | No |

## Users

**Primary: the non-technical owner** (ADR-0001). A consultant, tutor,
photographer, coach or café owner. Comfortable with Canva and Instagram, not with
a terminal. They judge the product on whether the result looks good without
design skill and whether they can change it themselves on a Sunday evening.

**Second: the agent.** A first-class actor, not a bolt-on. Every mutation
available to a human is available to an agent and vice versa, enforced by a
conformance test rather than by intent (R14). Agents are not trusted more or less
than humans — same validation, same authorisation, scoped and revocable tokens.

**Third: the developer or agency**, who is not designed for in milestone 1 but is
the natural second segment. Export and CLI are what will eventually attract them.

**When they conflict**, the owner wins the interface and the agent wins nothing
implicitly: an agent write that would clobber a human's concurrent edit is
rejected with a machine-readable conflict, never silently applied (ADR-0006).

## Scope boundary

Milestone 1 delivers **pages, blog and forms, then scheduling.**

**In**
- Visual drag-and-drop editor with templates and a first-party block library
- Theme tokens; a site can be restyled without being rebuilt
- Blog / content collections
- Forms with submissions, notifications, webhooks and CSV export
- Booking and scheduling with calendar sync
- Publish to a `*.prefab.app` subdomain or a customer's own domain with TLS
- CLI and MCP server at full parity with the editor
- Export: static bundle, self-host runtime, Astro eject
- Accounts, subscriptions and plan gates

**Out of milestone 1, deliberately**
- Payments blocks and event sign-ups — milestone 2, but the runtime API and BYO
  Stripe model are designed now so they are additive (ADR-0005)
- E-commerce: catalogue, cart, inventory. "Payments" means one-off and recurring
  payment blocks, not a store
- Membership and gated content — requires visitor identity, which we do not have
- Real-time multiplayer editing (ADR-0006 keeps the door open)
- Third-party blocks and a marketplace (ADR-0011)
- Email campaigns; we capture contacts and export them, we do not send campaigns
- Domain registration; bring your own
- Multilingual sites, though content is locale-keyed from day one so it is not a
  migration later
- A/B testing. Basic privacy-preserving page-view counts are in; experiments out

## Requirements

Each is stated so a test can check it.

**Core loop**

- **R1** An owner can go from picking a template to a published site on a
  `*.prefab.app` subdomain in under 10 minutes, measured on five unassisted
  first-time users.
- **R2** Drag, drop and reorder give visual feedback within 100 ms p95; a save
  round-trips within 400 ms p95.
- **R3** A published page derived from any shipped template scores LCP < 1.5 s
  p75 on simulated 4G and Lighthouse performance ≥ 90.
- **R4** Publishing a 50-page site completes within 10 s p95, and is atomic: a
  failed publish leaves the live site byte-identical to before. Publish time is
  **linear in page count** under the initial full-rebuild pipeline, so the bound
  at scale is stated separately: a 500-page site within 90 s p95. Breaching that
  is the trigger for ADR-0007's incremental-renderer escape hatch, not a reason
  to relax the number.
- **R5** Any previous publish can be restored in one action, within 10 s.
- **R6** Every first-party block passes axe-core with zero criticals, and shipped
  templates meet WCAG 2.2 AA contrast.

**Portability** — the differentiator, so these are hard requirements

- **R7** Export is available on every plan including free, with no gate, no
  delay, and no support ticket.
- **R8** `export → import → export` is byte-identical. Block identity, theme
  tokens and asset references all survive.
- **R9** An exported static bundle renders pixel-identical to the hosted site for
  all first-party blocks: ≤ 0.1 % pixel delta by screenshot diff.
- **R10** The exported self-host runtime serves the site and keeps forms and
  bookings functional with no connection to pre-fab infrastructure.
- **R11** An ejected project builds and runs with `npm install && npm run build`
  against upstream Astro, with no pre-fab package required at runtime.

**Programmability**

- **R12** Every mutation exposed by the HTTP API has a CLI command and an MCP
  tool. Asserted by a conformance test in CI, not by review (ADR-0003).
- **R13** Every CLI command supports `--json`, writes machine-readable errors
  with stable codes to stderr, and exits 0 ok / 1 user error / 2 conflict /
  3 auth / 4 upstream.
- **R14** An agent can orient on an unfamiliar site in one call: `site outline`
  returns every page and block as a compact tree with ids, types and one-line
  summaries.
- **R15** An agent can see its own work: every draft has a stable preview URL and
  `preview --json` returns a rendered screenshot path.
- **R16** The CLI can edit, build and preview a local checkout with no network.

**Integrity**

- **R17** A write carrying a stale base version is rejected with the current
  state and a diff. No write is ever silently lost (ADR-0006).
- **R18** Invalid input is rejected wholesale, naming the block id and field
  path. A patch never applies partially.
- **R19** A block type unknown to the renderer is preserved in the document,
  shown as a placeholder in the editor, and skipped on the published page. It is
  never dropped.
- **R20** No site source tree ever contains a secret or visitor PII. Connection
  credentials live in the platform, referenced by id.

## The shape

Six mechanisms. Everything else is detail.

### 1. The document

A site is a set of documents: `site.json`, `theme.json`, one document per page,
and content files for collections. Blocks are a **flat list** of nodes, each with
a ULID, a `parent` and an `order` — not a nested tree (ADR-0002). Flat lists diff
cleanly, patch unambiguously, and never force an agent to describe a position
positionally, which is what makes concurrent edits race.

Blocks reference theme tokens, never raw values. That single constraint is what
makes templates swappable and restyling possible.

### 2. One write path

```
  Editor (React)  ─┐
  CLI             ─┼─→  HTTP API  ─→  validate → migrate → version-check
  MCP server      ─┤         ↑                        ↓
  (future: API)   ─┘         └───────────────  Postgres (RLS)
```

The editor, CLI and MCP are all clients of the same API. MCP is a thin adapter
over the CLI's command layer, so it cannot drift. A mutation that is not in the
API does not exist in any surface (ADR-0003). This is the constraint that makes
agent parity a property of the architecture rather than a maintenance promise.

### 3. The projection

The database is the record; the file tree is a first-class bidirectional
projection (ADR-0002). `prefab pull` materialises a site as readable files;
`prefab push` sends them back through the same validation as any other write.
This is Terraform-shaped, not git-shaped: the files are real and diffable and
authoritative-on-push, but the platform holds history, permissions and identity.

### 4. The publish pipeline

Publishing renders the document to a static Astro build with React islands for
interactive blocks only, producing an **immutable, content-addressed bundle**.
Going live is a pointer swap. That is what makes R4's atomicity and R5's instant
rollback fall out for free rather than needing to be engineered.

### 5. The runtime API

Static pages cannot take a booking. Interactive islands call a small, stable
runtime API — form submit, booking create, later checkout. It is deliberately
tiny and deliberately separable, because it is exactly what the self-host runtime
must reimplement to satisfy R10 (ADR-0010). A CI check forbids the runtime
packages from importing control-plane packages, so the seam cannot rot.

### 6. The block contract

A block is a schema (fields, defaults, constraints), a React component, and a
migration chain. Blocks are versioned individually, so a block can change without
a site-wide migration. The contract is public but explicitly unstable in
milestone 1 (ADR-0011).

## Affordances

| Surface | Offers | Notably does not |
|---|---|---|
| Editor | Canvas drag/drop, inspector, template picker, theme editor, preview, publish, rollback | Free-form absolute positioning — three breakpoints with per-block overrides instead |
| CLI | Full mutation parity, `pull`/`push`, `diff`, local build and preview, `export` | Anything the API cannot do |
| MCP | Same commands as tools, plus `site outline` and screenshot preview | Elevated trust; tokens are per-site, scoped, expiring |
| Published site | Static pages, interactive islands, runtime API | Tenant-authored JS on its own origin (ADR-0011) |
| Self-host runtime | Serves the bundle, implements the runtime API | The editor. Editing is the hosted product |

## Implementation decisions

| Area | Decision | ADR |
|---|---|---|
| Beachhead user, agent parity | Non-technical owner first; agents are peers | ADR-0001 |
| Source of truth | Database of record, file tree as bidirectional projection | ADR-0002 |
| Surfaces | One write path for editor, CLI, MCP, API | ADR-0003 |
| Editor and blocks | React blocks, Puck canvas, framework behind the schema | ADR-0004 |
| Payments | Bring-your-own Stripe via OAuth, zero platform fee | ADR-0005 |
| Concurrency | Optimistic version check, no silent lost writes | ADR-0006 |
| Rendering and hosting | Static-first with islands, on Cloudflare | ADR-0007 |
| Tenancy | Shared Postgres with row-level security | ADR-0008 |
| Scheduling | Build the booking core; do not embed Cal.com | ADR-0009 |
| Portability | Three export tiers including an OSS self-host runtime | ADR-0010 |
| Block library | First-party only in milestone 1 | ADR-0011 |
| Pricing | Flat tiers, no transaction fee, export always free | ADR-0012 |
| Language | TypeScript for milestone 1, planned Go extraction seams | ADR-0013 |

## Testing approach

Layered, with the acceptance criteria at the top. Per-slice plans are in
`SLICES.md`.

**End-to-end** drives the real editor against a real API and a real publish.
These are the acceptance criteria; if they pass, the slice is done. Playwright,
Chromium.

**Contract tests** carry disproportionate weight here, because the product's
claims are contracts:
- *Parity* — enumerate API mutations, assert a CLI command and MCP tool for each
  (R12). This test failing is what stops agent support silently rotting.
- *Round-trip* — export, import, export, assert byte equality (R8).
- *Fidelity* — screenshot-diff hosted against exported (R9).
- *Separability* — static check that runtime packages import nothing from the
  control plane (R10).
- *Migration* — every block version migrates forward from every prior version.

**Integration** covers API against a real Postgres with RLS active, publish
against real object storage, and Stripe/calendar providers against their sandbox
or a recorded fixture.

**Unit** covers schema validation, migration functions, availability-to-slots
computation, and the diff engine — the pure, algorithmic parts.

**Performance and accessibility** are gates in CI, not aspirations: Lighthouse
budgets enforcing R3 and axe-core enforcing R6 on every template.

## Out of scope

Restated because an out-list only works if it is findable: e-commerce,
memberships, multiplayer editing, third-party block marketplace, email campaigns,
domain registration, multilingual sites, A/B testing, automated abuse detection,
and self-hosting the *control plane* — the site runtime is open source, the
platform is not.
