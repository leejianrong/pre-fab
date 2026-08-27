# ADR-0007: Static-first publishing with islands, hosted on Cloudflare

- **Status**: Accepted
- **Date**: 2026-08-27
- **Fork**: FORK-6

## Context

Published sites must be fast (R3: LCP < 1.5 s p75, Lighthouse ≥ 90), must publish
quickly and atomically (R4), must roll back instantly (R5), and must be
exportable in a form that still works elsewhere (R10, R11). They must also be
reachable on thousands of customer-owned domains with valid TLS.

Server-rendering every request would make personalisation easy and would make all
four of those harder.

## Decision

**Static-first.** Publishing renders the document to an Astro build with React
islands for interactive blocks only. Output is an **immutable,
content-addressed bundle**; going live is a pointer swap.

Dynamic behaviour — form submit, booking create, later checkout — goes through a
small, stable **runtime API** called by the islands.

**Hosted on Cloudflare**: Workers for Platforms for isolated per-tenant serving,
SSL for SaaS for automated certificates across customer domains, R2 for assets
(zero egress fees matter on image-heavy marketing sites), Postgres for the
control plane (ADR-0008).

Note the split, because it was initially conflated: Workers for Platforms serves
**tenant sites at the edge**. The **control plane** — editor API, auth, billing,
publish orchestration — is not required to run there and can be hosted anywhere
(ADR-0013).

## Consequences

- R4 atomicity and R5 instant rollback fall out of immutable bundles plus a
  pointer swap, rather than needing to be engineered.
- Export tier (a) — a static bundle that runs on any host — is nearly free,
  because it is what we already build.
- The self-host runtime never has to render React. It serves pre-rendered files
  and implements the runtime API, which is what makes ADR-0010's tier (b)
  tractable and, later, a candidate for a single Go binary (ADR-0013).
- Personalised or logged-in pages are not possible without revisiting this.
  Accepted; they are out of scope in PLAN.md.
- Content changes require a publish. For a small-business site this is correct
  behaviour, and it is what keeps the site fast.
- Custom-domain TLS at scale — the genuinely hard operational problem in this
  product class — is bought rather than built.

## Rejected

**Server-render per request.** Enables personalisation and memberships; costs the
performance targets, atomic publish, instant rollback, and a meaningful export.

**Static with no islands at all.** Would need iframed third-party widgets for
forms and bookings, which is the ugly, slow experience we are competing against.
