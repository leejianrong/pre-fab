# ADR-0012: Flat subscription, no transaction fee, export always free

- **Status**: Accepted
- **Date**: 2026-08-27
- **Fork**: FORK-9

## Context

The revenue model constrains what must be built in milestone 1 — metering,
billing, plan gates — and it interacts directly with the positioning. Wix and
Squarespace both take a cut of commerce revenue on some plans, and both make
leaving hard.

## Decision

- **Flat subscription tiers.** No usage-based pricing in milestone 1.
- **No transaction fee on tenant revenue**, following from ADR-0005 — money never
  touches us, so there is nothing to take a cut of.
- **Free tier** on a `*.prefab.app` subdomain with a small badge.
- **Custom domain is the first paid gate.** That is where purchase intent is: a
  user who has bought a domain has committed.
- **Bring your own domain.** We are not a registrar.
- **Export is free on every tier, always, with no gate, no delay and no support
  ticket** (R7).

Milestone 1 needs subscription state and plan gates only. Usage metering
(bandwidth, submission volume) is deferred.

## Consequences

- Revenue scales with sites, not with tenant success. Simpler to forecast and
  simpler to explain, and it forgoes the upside of hosting a customer who grows
  large.
- "We don't take a cut of your sales, and you can leave with your site" is one
  coherent position rather than two features. Both halves would be undermined by
  charging for either.
- Free-tier abuse is a real cost, bounded by ADR-0008's near-zero per-tenant cost
  and by manual takedown in milestone 1.
- Billing work in milestone 1 is small: Stripe subscriptions for *our* plans,
  which is a separate integration from the tenant's own Stripe under ADR-0005.
  These two must not be conflated in the code.

## Rejected

**Transaction fees on tenant commerce.** Requires Stripe Connect (rejected in
ADR-0005) and contradicts the positioning.

**Usage-based pricing.** Unpredictable bills terrify small business owners, and
metering is work milestone 1 does not need.

**Charging for export.** Explicitly forbidden. It would make the central claim a
bluff.
