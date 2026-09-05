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

## Unit economics under the custom-domain gate

Verified 2026-08-27, because the custom domain is the first paid gate and its
cost sets the floor under the entry tier.

| Line | Cost |
|---|---|
| Cloudflare custom hostname (SSL for SaaS) | **First 100 free** on Free/Pro/Business, then **$0.10 per hostname per month** |
| Pay-as-you-go ceiling | **50,000 custom hostnames**; beyond that requires Enterprise, pricing unpublished |
| Workers for Platforms | **$25/month platform-wide base**, including 20M requests and 60M CPU-ms; **$0.30 per additional million requests**, **$0.02 per additional million CPU-ms**. 1,000 scripts included, **$0.02 per additional script**. Only one request is billed across the dispatch chain, but CPU time is charged collectively across all three (dispatch → user → outbound) |

**The finding is that SSL for SaaS is not the binding constraint, and an earlier
note in planning implied it was.** At $0.10 per site per month — $1.20 a year —
the hostname fee is negligible against any plausible entry tier, and the first
100 paying customers cost nothing at all in hostname fees. Even a $5 entry tier
would carry a 98% margin on that line.

The floor is actually set by the $25/month platform base, which two or three
paying customers cover, and then by per-site variable cost: requests, CPU, R2
storage and operations, Postgres rows and email sends. All are small, and R2's
zero egress is what keeps image-heavy marketing sites cheap (ADR-0007).

**Resolved 2026-09-03 (KAN-1141):** Workers for Platforms' per-tenant component
is negligible at any plausible scale, confirming rather than revising that
conclusion. The $25 base includes 1,000 scripts (one dispatched Worker per
tenant site) before the $0.02/script overage even starts, so the first 1,000
paying customers cost nothing beyond the base on that dimension alone. The
20M-request/60M-CPU-ms included allotment, at $0.30/million requests and
$0.02/million CPU-ms overage, is immaterial against ADR-0007's static-first
design in particular: most requests never touch a Worker's CPU budget at all
(served from cache/R2), so only genuinely dynamic requests (a form submit, a
booking API call) consume it.

**Therefore the entry tier is priced on willingness to pay and competitive
position, not on cost.** Wix and Squarespace entry tiers sit around $16–25/month;
there is no cost-side reason to price above or below that band.

Recorded as a scale-stage risk rather than a launch problem: crossing 50,000
custom domains moves us to an Enterprise contract with unpublished pricing, so
that negotiation should start well before the cap.

Caveat on sourcing: `developers.cloudflare.com` is blocked by this environment's
egress proxy, so the hostname figures come from two independent secondary sources
that agree, not from the primary docs. Confirm against Cloudflare's billing page
before the pricing page goes live. One secondary source also quoted "$10/month",
which appears to be Advanced Certificate Manager — a separate optional per-zone
product, not a per-hostname charge — but that reading is inferred, not verified.

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
