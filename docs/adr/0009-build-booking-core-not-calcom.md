# ADR-0009: Build the booking core; do not embed Cal.com

- **Status**: Accepted
- **Date**: 2026-08-27

## Context

Scheduling is in milestone 1. Cal.com is the obvious build-versus-buy candidate:
mature, well-designed, self-hostable, and it does far more than we need.

It is licensed **AGPLv3**, with enterprise features under a separate commercial
licence.

## Decision

**Build a small booking core. Do not embed or self-host Cal.com.**

Two independent reasons:

1. **Licence.** AGPLv3's network clause means running a modified copy as part of
   a hosted multi-tenant service extends the source-provision obligation over
   that service. Untangling which parts of our stack that reaches is a legal
   question we would be answering repeatedly, forever.
2. **Strategy.** The escape hatch — buying Cal.com's commercial licence —
   reintroduces exactly the vendor dependency the product is sold against. We
   cannot credibly promise "no vendor lock-in" while our scheduling is licensed
   from a company that can change its terms.

Scope of what we build, deliberately small:

- Availability rules: weekly recurring windows, date overrides, buffers, minimum
  notice, maximum horizon.
- Slot computation from rules minus existing bookings and synced busy time.
- Booking creation with confirmation email and an ICS attachment.
- Two-way sync with Google Calendar and Microsoft 365 via their APIs.
- Timezone correctness, including DST boundaries.

## Consequences

- Several weeks of work that could have been an integration. Costed and accepted.
- We control the booking data model, so bookings export with the site (R10) and
  the self-host runtime can serve them.
- We will not match Cal.com's depth — no routing forms, no round-robin teams, no
  payment-on-booking in milestone 1. Correct for the target user.
- Slot computation and DST handling is the algorithmically riskiest code in the
  product and gets the heaviest unit-test coverage.

## Rejected

**Embed self-hosted Cal.com.** Licence contamination across a commercial hosted
service.

**Cal.com commercial licence.** Contradicts the product's core promise, and puts
a third party's pricing in the middle of our margin.

**Embed a proprietary widget (Calendly and similar).** Iframe experience, no data
ownership, and bookings would not survive export — a direct violation of R10.
