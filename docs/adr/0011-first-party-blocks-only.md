# ADR-0011: First-party blocks only in milestone 1

- **Status**: Accepted
- **Date**: 2026-08-27
- **Fork**: FORK-8

## Context

A third-party block ecosystem is the obvious long-term moat, and it is what
eventually made WordPress unassailable. It also requires code sandboxing, a review
process, versioning and compatibility policy, a distribution mechanism, and a
security posture for running other people's code inside customers' sites.

None of that is affordable in milestone 1, and getting it wrong once is a
tenant-escape incident.

## Decision

**First-party blocks only.** The block contract is public and documented, but
explicitly marked **unstable** — no compatibility guarantee until after
milestone 1.

Consequences for the security model:

- No tenant-authored JavaScript on the site's own origin. A raw-HTML embed block
  renders inside a **sandboxed iframe**. Arbitrary first-party JS is the single
  largest XSS and tenant-escape risk in this product class.
- Because all block code is ours, block rendering needs no isolation boundary in
  milestone 1. That boundary is expensive and is deferred with eyes open.

**Templates** are a separate mechanism from blocks:

- A template is a **seed**, forked on use. Template updates do **not** propagate
  into sites already using them. Propagating structural changes into edited sites
  is unsolved in practice by everyone who has tried it.
- The **theme** (`theme.json` tokens) *is* separately swappable, so a site can be
  restyled without being re-templated. This is the upgrade path that actually
  works.
- Templates are authored in-house as ordinary exported site trees, which
  dogfoods the export format (ADR-0002).
- Eight at launch, covering consultant, photographer, tutor, café, fitness coach,
  small agency, event and personal brand. Fewer than that and "pretty by default"
  fails for the beachhead user (ADR-0001).

Responsive behaviour is authored as automatic per-block rules with optional
overrides at three breakpoints — not free-form absolute positioning, which is how
no-code builders produce broken mobile layouts.

## Consequences

- No ecosystem flywheel in milestone 1. Accepted; there is no ecosystem without
  users first.
- Every block a customer needs, we must build. Block coverage is a roadmap item
  with real ongoing cost.
- Opening the ecosystem later requires adding an isolation boundary and a
  stability guarantee — significant work, but additive rather than a rewrite,
  because the contract exists from day one.
- Marking the contract public-but-unstable lets us learn from anyone who builds
  against it early without owing them compatibility.

## Rejected

**Open marketplace from the start.** Sandboxing, review and versioning costs
before there is any demand, plus a security surface we cannot yet staff.

**Fully closed contract.** Costs nothing to document it, and doing so shapes the
internal design toward the boundary we will eventually need.
