# ADR-0010: Export means three tiers, including an open-source self-host runtime

- **Status**: Accepted
- **Date**: 2026-08-27
- **Fork**: FORK-7

## Context

"No vendor lock-in" is the product's central claim, and it is the claim most
easily reduced to marketing. Every incumbent offers *an* export. Squarespace and
Wix will hand over content in some form; what they will not hand over is a
working site. The dynamic parts — forms, bookings, checkout — die at the boundary,
because they were never the customer's.

So the promise has to be specific enough to be testable, or it is worth nothing.

## Decision

Export means three tiers, all free on every plan including free (R7).

**(a) Static bundle.** The published output — HTML, CSS, JS, assets — that runs
on any static host. Nearly free to provide, because ADR-0007 already builds
exactly this. Dynamic features are inert.

**(b) Self-host runtime.** An **Apache-2.0** licensed runtime that serves the
bundle and implements the runtime API, so **forms and bookings keep working with
no connection to pre-fab infrastructure** (R10). This is the differentiator and
the tier the incumbents cannot match.

**(c) Astro eject.** A conventional Astro project that builds and runs with
`npm install && npm run build` against upstream Astro, with no pre-fab package
required at runtime (R11).

Two structural commitments make (b) real rather than aspirational:

1. **Separability from commit one.** The runtime packages are separate from the
   control plane, and a CI check fails the build if a runtime package imports a
   control-plane package. A seam only survives if something enforces it.
2. **Apache-2.0, not copyleft.** A copyleft self-host runtime would impose
   obligations on the customer who took our advice to leave, which would make the
   promise hollow in a different way. The repository is already Apache-2.0.

Fidelity is a tested contract, not a hope: exported output must render
pixel-identical to the hosted site for all first-party blocks, ≤ 0.1 % delta by
screenshot diff (R9), and `export → import → export` must be byte-identical (R8).

## Consequences

- The runtime API must stay small and stable, because every addition is something
  the self-host runtime must reimplement. This is a useful constraint on scope
  creep in the dynamic surface.
- Some customers will leave, and will leave successfully. That is the point;
  the retention argument is that the product is good, not that the exit is
  blocked.
- Tier (b) cannot be bolted on later without disentangling the runtime from the
  control plane, which is why the CI separability check exists from the start.
- Because ADR-0007 pre-renders at publish time, the self-host runtime never has
  to render React — it serves static files and implements a small API. That keeps
  it small, and makes it a clean candidate for a single Go binary later
  (ADR-0013).
- Support burden from self-hosters. Mitigated by scope: we support the runtime as
  software, not the customer's infrastructure.

## Rejected

**Static export only.** What the incumbents already do. Does not differentiate,
and quietly breaks every dynamic feature.

**Export as a paid feature.** Makes the anti-lock-in promise a bluff. Explicitly
forbidden on every tier (ADR-0012).

**Open-sourcing the whole platform.** Not milestone 1, and not required by the
promise. The *site* is the customer's; the control plane is the business.
