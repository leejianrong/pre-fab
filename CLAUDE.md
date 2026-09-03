# pre-fab

A no-code website builder where the site is a portable, diffable artifact the
customer owns. Competes with Wix and Squarespace on the thing neither can do:
hand over a working site.

**Status: Slices 1–9 built — milestone 1 complete.** One write path, the block
library and theme tokens, templates/onboarding, custom domains/TLS,
blog/collections, forms/submissions, self-host runtime/eject, accounts/plans/
billing, and scheduling/bookings are done — see `README.md` for what each
shipped. Slice 4 runs against a fake Cloudflare adapter, Slice 6's
email/Turnstile/webhook and Slice 8's Stripe adapters are likewise unverified
against real providers, and Slice 9's Google Calendar/Microsoft 365 adapters
are the same: structurally complete, written from each provider's public
docs, never exercised against a live account (no real accounts exist in this
environment).

## Read before changing anything

| File | What it is |
|---|---|
| `PLAN.md` | The live document. Problem, scope, 20 numbered requirements, the six mechanisms |
| `docs/adr/0001`–`0013` | **Binding decisions.** Each records what was rejected and why |
| `SLICES.md` | Build sequence. Nine vertical slices, risk-first |
| `QUESTIONS.md` | Decision register — every question asked, answered or deferred |

ADRs are decisions, not suggestions. If one looks wrong, **supersede it with a new
ADR** explaining what changed. Do not quietly build against a different choice,
and do not re-open one whose "Rejected" section already addresses your objection —
several were reconsidered once and held.

## Subagents

**Hard limit: at most 3 subagents working on this codebase at any one time.** This
is a ceiling, not a target. Do not exceed it for a task that "just needs one
more", and do not work around it by chaining agents that spawn agents.

**Every subagent works in its own git worktree** — pass `isolation: "worktree"`.
Agents editing a shared checkout in parallel corrupt each other's work in ways
that surface later as mystery diffs.

The limit is **enforced, not advisory**: `.claude/hooks/agent-limit.sh` counts
running agents via slot files and a `PreToolUse` hook denies the fourth. Slots
are released on `SubagentStop`, reset at session start, and expire after two
hours so a crashed agent cannot wedge the limit shut. Raise `LIMIT` in that
script if the ceiling ever genuinely needs to move — and change this file to
match, so the rule and its enforcement never disagree.

Prefer fewer. Most work here is one agent deep in one slice, and slices are
sequenced so they do not need to run concurrently.

Multiple subagents running `make dev` in their own worktrees no longer need
manual port coordination — `scripts/dev-ports.sh` (auto-run by `up`/`dev`)
picks the next free `PREFAB_PROXY_PORT`/`PREFAB_API_HOST_PORT`/
`PREFAB_POSTGRES_PORT` per worktree's `.env` on its own. Each worktree's
`make dev` output prints the URLs it landed on.

## Invariants

Each is enforced by CI. Breaking one is a build failure, not a review comment.

1. **Every mutation has three surfaces.** An API endpoint, a CLI command and an
   MCP tool, or the parity conformance test fails. A mutation not in the API does
   not exist. (ADR-0003)
2. **Blocks reference theme tokens, never raw values.** No hex codes, no pixel
   literals in a block. This is what makes templates swappable. (ADR-0002)
3. **Nothing outside the publish pipeline imports Astro**, and **block components
   never import Puck context**. Blocks must be SSR-safe: no browser-only APIs
   outside effects. (ADR-0004, ADR-0007)
4. **Runtime packages never import control-plane packages.** The self-host runtime
   must be extractable, and a seam only survives if something enforces it.
   (ADR-0010)
5. **No secrets and no visitor PII in a site source tree.** Site trees are
   designed to be exported, shared and committed. Credentials live in the
   platform, referenced by id. Form and booking submissions live in platform
   Postgres, never in the tree. (ADR-0008, R20)

Two more that are not yet automated but are just as binding:

- **Blocks are addressed by ULID, never positionally.** No "the third block".
  Positional references are what make concurrent agent edits race. (ADR-0002)
- **No write is ever silently lost.** Stale-version writes are rejected with the
  current state and a diff, exit code 2. Never last-write-wins. (ADR-0006)

## Stack

TypeScript end-to-end, pnpm monorepo (ADR-0013). React 19 — the only major
satisfying both `@puckeditor/core` and `@astrojs/react` v6.

- Editor canvas: **`@puckeditor/core`**, not `@measured/puck` (renamed; the old
  package is stale). **Pin the exact version** — Puck is pre-1.0, so minors break.
- Publish: Astro with React islands, static-first, immutable content-addressed
  bundles, pointer swap to go live.
- Data: Postgres with row-level security keyed on `site_id`.
- Hosting: Cloudflare — Workers for Platforms, SSL for SaaS, R2.

## Conventions

- Work on a branch; never commit to `main` directly.
- Requirements are cited as `R1`–`R20` (defined in `PLAN.md`), decisions as
  `ADR-NNNN`. Use these in commit messages and PR bodies — they are how the plan
  stays connected to the code.
- End-to-end tests in `SLICES.md` are the acceptance criteria for a slice. A
  slice is done when they pass, not when the code looks finished.

Exact build/test/dev commands are in `README.md`'s Local setup, Tests and CI
sections — trust those (and the actual `package.json` scripts) over any
paraphrase here if they ever disagree.
