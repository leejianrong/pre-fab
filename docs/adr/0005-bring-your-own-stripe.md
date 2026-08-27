# ADR-0005: Bring-your-own Stripe, zero platform fee

- **Status**: Accepted
- **Date**: 2026-08-27
- **Fork**: FORK-5

## Context

Payment blocks arrive in milestone 2, but the architecture must be settled now
because it is close to unretrofittable and it determines the revenue model.

Two shapes:

- **Stripe Connect**, where we are the platform, tenants are sub-accounts, and we
  can take an application fee on every transaction.
- **Bring-your-own Stripe**, where the tenant connects their own account by OAuth
  and money never touches us.

## Decision

Bring-your-own Stripe via OAuth. **Zero platform fee on tenant revenue.**

Funds move directly between the tenant's customer and the tenant's own Stripe
account. We store an OAuth grant, not a balance.

## Consequences

- No money transmission exposure, materially lighter compliance, and no
  responsibility for tenant payouts, disputes or refunds.
- "We don't take a cut of your sales" is a direct, checkable hit on Wix and
  Squarespace transaction fees, and it reinforces the anti-lock-in position: a
  tenant who leaves keeps their payment history and their customer relationships,
  because those were never ours.
- Transaction revenue is forgone permanently. Retrofitting Connect later would
  mean re-onboarding every tenant, so this is close to irreversible. Accepted:
  the subscription is the business (ADR-0012).
- Onboarding quality is partly Stripe's. We control the connect flow and the
  error surfaces, not the account application.
- The self-host runtime can implement checkout against the tenant's own keys
  without us at all, which is what makes R10 honest for payments.

## Rejected

**Stripe Connect as the platform.** Better monetisation, and it makes us a party
to every transaction: compliance load, payout support, dispute handling, and a
contradiction with the ownership story we are selling.
