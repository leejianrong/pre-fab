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

## Verified versions

Checked 2026-08-27 against the npm registry: `@astrojs/react` v6.0.4 peers
`react` and `react-dom` at `^17.0.2 || ^18.0.0 || ^19.0.0`, and has done since
v4. `@puckeditor/core` 0.23.0 peers `react` at `^18.0.0 || ^19.0.0`. **React 19
satisfies both**, so the editor and the publish pipeline share one React
(ADR-0004). `@astrojs/react` v6 depends on Vite 8; the editor SPA should track
the same Vite major.

## What Astro is actually load-bearing for

Worth stating plainly, because it is easy to over-attribute.

Technically Astro buys us less than it appears. We generate every page from a
document, so we need none of a meta-framework's file-based routing, layouts or
conventions. What it provides is a maintained build pipeline — bundling, CSS,
image optimization, island hydration — for a block set we control and could
hydrate ourselves.

**Astro's real load is R11, the eject target.** ADR-0010 tier (c) is worth
something only because Astro is popular and community-supported. Ejecting to a
bespoke pre-fab renderer would not be an eject; it would be lock-in in different
clothing. Astro is therefore more load-bearing for the *portability promise* than
for publishing.

Two consequences follow, and both are recorded now rather than discovered later.

**The known scaling limit.** Astro rebuilds the whole site. Fifty pages in ten
seconds is comfortable; a 500-page blog rebuilding entirely to fix one typo is
not, and publish time is linear in page count (R4).

**The planned escape hatch — decouple the publish renderer from the eject
target.** They need not be the same pipeline. Publish can move to a custom
renderer doing incremental per-page builds, while eject continues to *generate*
an Astro project as an export artifact. This is safe rather than reckless because
R9's screenshot-diff test already asserts that two rendering paths produce
identical output; the safety net for the drift it introduces is a test we
committed to building regardless.

Milestone 1 uses Astro for both paths — one pipeline, simplest thing that works.
The escape hatch is triggered by measured publish times at scale, not by
speculation. Same pattern as ADR-0013's Go seams: name the seam, do not build it.

**Containment constraint.** Nothing outside the publish pipeline and the eject
generator may import Astro. Blocks, schema, write path, editor and runtime API
stay Astro-free, so being wrong about Astro costs a pipeline rather than a
product. Enforced by the same CI import check that guards ADR-0010's runtime
separability.

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
