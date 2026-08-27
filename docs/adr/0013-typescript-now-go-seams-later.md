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
