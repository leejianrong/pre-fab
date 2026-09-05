# ADR-0013: TypeScript for milestone 1, with planned Go extraction seams

- **Status**: Accepted
- **Date**: 2026-08-27
- **Fork**: FORK-10

## Context

The backend language was initially proposed as Python/FastAPI, then widened to Go
or Node.

One framing error should be recorded, because it nearly drove the decision. "Python
Workers is in open beta, so FastAPI cannot run on Cloudflare" is true and was
treated as disqualifying. It is not. Workers for Platforms exists to serve
**tenant sites at the edge**; the **control plane** can run anywhere (ADR-0007).
Go is excluded from Workers for the same irrelevant reason — WASM-only via
TinyGo, under a 1 MB script limit.

The real axis is **schema duplication**. Block types, validation, defaults and
migrations must execute in the API, the CLI, **and the renderer**. The renderer is
JavaScript permanently, because blocks are React components (ADR-0004). Any
non-JS backend therefore defines the schema twice.

Where Go genuinely wins for this product, and these are not generic arguments:

- The publish pipeline is concurrent I/O orchestration — build fan-out, domain
  provisioning, webhook delivery, calendar-sync polling.
- The self-host runtime could ship as a **single static binary**. Because
  ADR-0007 pre-renders at publish time, that runtime never renders React: it
  serves static files and implements the small runtime API. That is a JS-free
  target, and "download one binary, run your site" is a materially better
  self-host story than "install Node, npm i" for ADR-0010's tier (b).

The strongest counter to the duplication argument is to make the schema **data
rather than code** — declarative JSON Schema evaluated in any language, with only
rendering in JS. That works for validation, and breaks on migrations, which are
functions, and on conditional field logic. It shrinks the tax rather than
removing it.

## Decision

**TypeScript end-to-end for milestone 1**: API, schema, renderer, CLI, MCP
server. One language, one schema package, one deploy target.

The schema churns hardest in the first three months, which is exactly when a
duplication tax costs most. Slice 1's risk — schema → editor → renderer — is
entirely JavaScript, and adding a second language before the schema stabilises
buys concurrency the product does not yet need.

**Two Go extractions are planned, not speculative**, and the code is structured to
keep the seams clean. Both sit at genuine process boundaries, so neither is a
rewrite:

1. **The self-host runtime as a single Go binary**, once the runtime API is
   stable. ADR-0010's CI separability check already enforces the boundary this
   requires.
2. **The publish orchestrator**, if build fan-out profiles badly on Node.

Python is reserved for analytics/data jobs and AI/ML services later — a clean
seam at a process boundary, and no unique advantage over the alternatives for
this workload.

## Consequences

- One schema definition, shared directly between API, CLI and renderer, for the
  period when it changes most.
- The control plane is not tied to Cloudflare Workers and can be hosted wherever
  is convenient; Cloudflare's load-bearing role is edge serving, SSL for SaaS and
  R2 (ADR-0007).
- Node's concurrency limits will eventually show up in publish fan-out. The
  mitigation is planned rather than discovered, and profiling that pipeline is a
  named task in the slice that builds it.
- If the single-binary self-host runtime becomes the headline marketing claim
  before extraction 1 happens, that claim waits on the extraction. Retrofitting
  "one binary" onto a Node runtime is a rewrite, which is why the seam is
  enforced from the start rather than intended.

## Rejected

**Go from day one.** Defensible on exactly one argument — leading with the
single-binary self-host runtime. Declined because it pays the schema-duplication
tax at the moment the schema is least stable.

**Python/FastAPI.** No unique advantage for this workload over the other two, and
the same duplication cost as Go without Go's concurrency or single-binary payoff.

## Evaluated 2026-09-04 (KAN-1140): neither extraction is triggered yet

Both conditions this ADR named were checked against running code and measured
numbers, not argued in the abstract. Conclusion for both: **not yet**, and the
evidence below is specific enough to say what would change that.

### 1. Self-host runtime as a single Go binary — trigger: "once the runtime API is stable"

**Stability.** `packages/runtime/` and `apps/self-host/` only exist since Slice 7
(`66db201`, 2026-08-29) and were touched once since, additively, by Slice 9
(`bbc853e`, 2026-08-31 — booking endpoints: new files, new exports added to
`app.ts`'s import list, zero changes to the existing form routes/types). Two
dependency-bump commits are the only other history. That is not "stable" in the
sense the trigger means — it is "hasn't needed a breaking change yet because
nothing has exercised it under real traffic" (no self-host deployment exists
outside this repo's own tests). Genuinely different claim; worth re-checking
after milestone 2's blocks (payments, event sign-ups) land, since those are the
next likely source of a runtime-API-shaped requirement.

**Whether Node is actually the problem.** Built the checked-in `cafe` template
(`packages/templates/templates/cafe/`) through `@prefab/publish`'s real
`buildSiteBundle` (bypassing the API/DB, which this task doesn't need) into a
static bundle, then ran `apps/self-host` against
it exactly as the Dockerfile ships it (`node --import tsx src/server.ts`),
timing from process launch to first `200` in one shell (cross-process timing
across separate tool calls inflated early readings 15–35x by including
inter-call latency — three same-process, single-shell runs are what's reported):

| Config | Cold start (launch → first 200) | Idle RSS (settled, 5s) |
|---|---|---|
| As shipped (`node --import tsx src/server.ts`) | 324ms, 310ms, 327ms | ~126 MB, stable across 5s and after 10 requests |
| Precompiled (`tsc` then `node dist/server.js`) | 182ms, 178ms, 195ms | ~90 MB at startup |

Neither number is a problem. 300ms is imperceptible for "start a container,
serve a site"; 126MB idle is unremarkable for a Fastify + better-sqlite3
process. A Go binary would likely start in single-digit milliseconds and idle
in single-digit megabytes, but there is no evidence anyone is waiting on the
extra ~250ms or that 126MB has cost the product anything — no self-host
customer exists yet to be bothered by it. The gap that's real is ergonomic, not
performance: `docker run` vs `download one binary, run your site` is a
genuinely different onboarding story (ADR-0007's tier (b) claim), but that's a
marketing/adoption argument, not the "profiles badly" kind of evidence this
ADR asked for before extracting. One concrete, cheap win either way: the
compiled-vs-tsx gap above (324ms → 182ms, ~126MB → ~90MB) is available today
by adding a real `tsc` build step to the Dockerfile instead of shipping
`--import tsx` to production — worth doing regardless of whether a Go
extraction ever happens, since it's a same-language, no-risk change.

### 2. Publish orchestrator — trigger: "if build fan-out profiles badly on Node"

`apps/api/src/app.ts`'s `publish.create`/`publish.rollback` routes each call
`buildSiteBundle` once per request, with **no concurrency cap anywhere in the
call path** — `packages/publish/src/build.ts` spawns one `node --import tsx
build-worker.ts` subprocess per build, unconditionally. Fanned out N concurrent
`buildSiteBundle` calls directly (bypassing HTTP, which adds nothing here since
the route does the same one call) against a mix of the nine checked-in
templates, on a 20-core / 31GB test machine:

| N | Wall clock | Per-build mean | Per-build vs N=1 | Throughput |
|---|---|---|---|---|
| 1 | 1,671 ms | 1,668 ms | 1.0x | 0.6 builds/s |
| 5 | 2,199 ms | 2,116 ms | 1.3x | 2.3 builds/s |
| 20 | 7,073–7,262 ms | 6,645–6,985 ms | 4.2x | 2.7–2.8 builds/s |
| 50 | 25,007 ms | 23,238 ms | 13.9x | 2.0 builds/s |

All 146 builds across every trial (including repeat N=20/N=50 runs used for
the CPU/memory sampling below) succeeded — nothing crashed or errored, though
a second N=50 trial run concurrently with `ps`/`vmstat` sampling took longer
still (30.9s wall, 29.6s per-build mean), consistent with the swap-driven
degradation this section describes rather than contradicting it. Throughput
peaks around N=20 (matching the core count) and **drops** at N=50:
that's the non-linear degradation the ADR asked to confirm or disconfirm, and
it's real. `ps` sampling during the N=20/50 runs showed each `build-worker`
subprocess pegged at 85–92% of one core — this is CPU-bound work (Vite/esbuild
compilation plus React SSR), not I/O wait, and not the orchestrator's own event
loop: the process spawning and awaiting those builds was never observed
CPU-bound, only the builds themselves. `vmstat` during the N=50 run showed the
run queue climb past 100 runnable processes and swap usage grow by roughly 2GB
over ~16 seconds as free memory fell under 500MB out of 31GB — actual memory
pressure from ~50 concurrent Astro/Vite processes (each several hundred MB to
just over 1GB RSS while building), not just CPU contention.

That is a real problem, but it is not the problem this ADR predicted. The
bottleneck is CPU-bound Vite/esbuild/React-SSR work happening inside per-build
subprocesses that `build-worker.ts` *already* isolates onto separate OS
processes (deliberately, for an unrelated Vite/react-dom module-cache reason —
see that file's own header comment) — so this fan-out is already scheduled
across real OS cores, not serialized behind Node's single-threaded event loop.
Per ADR-0007, that compilation work stays JavaScript (Astro + React islands)
regardless of what orchestrates it, so a Go orchestrator would spawn the exact
same CPU- and memory-hungry Node subprocesses and hit the exact same ceiling at
the exact same N. What's actually missing is a **concurrency cap** — nothing
bounds how many builds run at once today, so an unlucky burst of concurrent
publishes can push the control-plane host into swap. The fix is a small,
same-language change (a bounded worker queue in `packages/publish` or the
`publish.create` route, capped near the host's core count) — not a rewrite,
and not evidence for a Go extraction, since the ceiling is physical (CPU cores,
RAM per Vite process) rather than linguistic.

**Recommendation: not yet, for either extraction**, on the evidence above. What
would change it: (1) a self-host runtime API that's gone a full milestone with
no shape change, or a real self-host customer for whom cold start / binary size
is a stated blocker; (2) production publish traffic that actually produces
unbounded concurrent bursts before a concurrency cap is added — at which point
the cap is the fix to try first, and only a cap that still can't keep the host
off swap would be evidence for moving the orchestrator itself.

Benchmark scripts used for this evaluation are not checked in (kept out of
product code per this task's scope): `packages/publish/.bench/build-one.ts`,
`packages/publish/.bench/fanout.ts`, `packages/publish/.bench/coldstart.sh`,
`packages/publish/.bench/idlemem.sh` in the worktree this evaluation ran in.
