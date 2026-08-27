# ADR-0008: Shared Postgres with row-level security

- **Status**: Accepted
- **Date**: 2026-08-27

## Context

Multi-tenancy at freelancer price points. A free tier exists (ADR-0012), so the
per-tenant fixed cost must be near zero. Tenants are numerous, individually tiny,
and mostly idle.

## Decision

One Postgres cluster, shared schema, **row-level security keyed on `site_id`**.
Object storage is prefixed per tenant. The application connects with a role that
cannot bypass RLS, and the tenant context is set per transaction.

Visitor-submitted records — form entries, bookings — live in platform Postgres,
**not** in the site source tree. Mixing visitor PII into an artifact designed to
be exported, shared and committed is a data-protection trap (R20). They are
exportable as CSV/JSON on demand.

## Consequences

- Per-tenant cost approaches zero, which is what makes a free tier viable.
- RLS must be tested as a security boundary, not assumed. Integration tests run
  against real Postgres with RLS active and assert cross-tenant reads fail.
- A single noisy tenant can affect others. Acceptable at the target scale;
  the escape hatch is moving large tenants to a dedicated database later, which
  the `site_id` keying makes mechanical.
- Storage is region-tagged from day one so data residency is a configuration
  problem later rather than a migration.

## Rejected

**Database per tenant.** Strong isolation, and operationally heavy: thousands of
schemas to migrate, connection pool pressure, and a per-tenant fixed cost that
kills the free tier.

**Application-level filtering with no RLS.** One missing `WHERE site_id = ...` is
a cross-tenant data leak. The database should enforce the boundary that matters
most.
