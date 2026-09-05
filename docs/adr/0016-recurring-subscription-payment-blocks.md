# ADR-0016: Recurring/subscription payment blocks — a distinct block type, Stripe's own status vocabulary

- **Status**: Accepted
- **Date**: 2026-09-05
- **Fork**: KAN-1154 (part 1 of 2, split the same way KAN-1137/KAN-1129 were)

## Context

KAN-1137 (Slice 10, ADR-0005) shipped one-off Payment blocks: bring-your-own
Stripe, `mode: "payment"`, a flat `amount` in cents, a `payment_records` row
per Checkout session that only ever needs three terminal-ish states
(`pending`/`completed`/`failed`). KAN-1154 asks for the recurring/subscription
counterpart, and — same discipline as KAN-1129's ADR-0014 — asks the
schema/lifecycle question to be scoped in writing before anything is built,
because a subscription is not a bigger one-off payment: it has an ongoing
relationship with the tenant's Stripe account (renewals, dunning,
cancellation) that a single Checkout session settling once never had.

This ADR is part 1's design note. Part 1 (this PR) builds the schema, the new
block, and subscription *checkout-session creation*. Part 2 (a follow-up
card) builds the webhook consumer that actually drives the lifecycle this
ADR designs the state machine and table for — see "Known gap for part 2" in
the PR body, not this document, for the operational detail of what's left.

Three questions, same as the card lists them:

### 1. Same block type with new props, or a distinct block type?

Looked at what exists today first, per the card's instruction —
`packages/blocks/src/payment/schema.ts`'s `PaymentPropsSchema`:

```
heading, description, buttonLabel, amount (cents, flat), currency, successMessage
```

`amount` names a single, one-time charge. A subscription's price is
per-*interval* — "$25" means nothing on its own; it means "$25/month" or
"$25/year", and that unit is load-bearing everywhere downstream: what
Stripe's own `price_data[recurring][interval]` field requires, what a
visitor is shown before they pay, what a receipt says. There is no reading
of "reuse `amount`" that doesn't either (a) silently repurpose an existing,
already-shipped field's meaning for every new subscription block — exactly
the "renamed field / changed unit" case `docs/BLOCK_CONTRACT.md`'s
Versioning section says needs a version bump and a migration, not a bare
`.default()` — or (b) leave `amount` as "the one-time price" and bolt an
`interval` field onto the *same* schema that only applies conditionally,
which means every reader of a `payment` block's props (the publish
snapshot loop, the runtime checkout port, the owner dashboard, a future
export/import round-trip) has to branch on "is this one actually recurring"
before it can trust what `amount`/`interval` mean together — conditional
validation baked into one block type for two genuinely different checkout
shapes.

Beyond the schema, the *lifecycle* differs in a way no amount of prop
reshuffling papers over: a one-off `payment_records` row is written once and
transitions at most once (`pending` → `completed`/`failed`). A subscription
record is written once and then **kept alive and rewritten indefinitely** —
every renewal, every failed-then-recovered invoice, every cancellation
touches the same row for months or years. Folding that into `payment_records`
means every one-off payment's row shape grows five columns
(`stripe_subscription_id`, `interval`, `trial_period_days`,
`current_period_end`, `cancel_at_period_end`, `canceled_at`) it will
permanently NULL/default and never use, and every reader of that table (the
existing dev-advance route, the existing real webhook handler, the existing
owner-facing `payment.list`) has to keep ignoring columns that don't apply to
it. That's exactly the shape ADR-0014 rejected for free-positioning (a
conditional field bag on an existing, working shape) for the identical
reason: it's cheaper to keep two things that behave differently *looking*
different than to make one shape quietly mean two things.

**Decision: a distinct block type, `subscription`**, its own props schema, its
own component, its own DB tables. The existing `payment` block, its schema,
its component, `payment_blocks`/`payment_records`, and every route that
touches them are **completely untouched** by this PR — not "unlikely to be
affected," verified by running every existing payment test unchanged (see the
PR's test evidence).

`SubscriptionPropsSchema` (`packages/blocks/src/subscription/schema.ts`):

```ts
{
  heading: string (1-120),
  description: string (0-500, default ""),
  buttonLabel: string (1-40, default "Subscribe"),
  price: number int positive, max 99_999_999,      // cents, PER INTERVAL — never "amount"
  currency: string, lowercase ISO 4217, default "usd",
  interval: "month" | "year", default "month",
  trialPeriodDays: number int, 0-365, default 0,
  successMessage: string (0-300, default "Thank you — your subscription is active."),
}
```

`price` (not `amount`) is a deliberate rename from the one-off block's own
field, not an oversight of "why isn't this called the same thing" — it is
the one-off block's `amount` in every way (cents, server-resolved, never
trusted from a visitor's own request) *except* that its meaning is
per-interval, and giving it a different name is what stops a future reader
from assuming "amount" always means "the total, once" the way it does on
every other block. `trialPeriodDays` is new surface the one-off block has no
analogue for at all (a one-off payment cannot have a trial) — included now,
bounded and defaulted, because Stripe Checkout takes it as a single
`subscription_data[trial_period_days]` field at session-creation time (this
part's own scope), not as a later lifecycle transition (part 2's scope), so
leaving it out would mean re-opening this schema for something that costs
nothing to include now.

### 2. Subscription lifecycle states

Stripe's own `Subscription.status` enum
(https://docs.stripe.com/api/subscriptions/object#subscription_object-status,
conceptually reviewed — no live account exists in this environment, the same
constraint every adapter in this repo already carries, see
`tenant-stripe-provider.ts`'s own module comment) is: `incomplete`,
`incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`,
`unpaid`, `paused`.

**Decision: store Stripe's own status strings verbatim, not a
platform-invented enum.** `payment_records.status` (`pending`/`completed`/
`failed`) is *not* Stripe's own Checkout Session status vocabulary — it's a
small platform-invented projection of it, and that was fine for one-off
payments because the mapping from "Checkout session completed" to
"completed" is a single, obvious step with no reason to ever diverge from
Stripe's own wording. A subscription's lifecycle has no such single mapping:
`invoice.payment_failed` doesn't always mean `past_due` (Stripe's own retry
schedule and Smart Retries settings decide that), and `customer.
subscription.updated` carries a `status` field that already *is* the
platform-meaningful state — inventing a second vocabulary next to Stripe's
own would mean writing and maintaining a translation table part 2 has to get
right in both directions with no test double (no live account) to catch a
mismatched mapping. Storing Stripe's status directly means part 2's webhook
handler writes `event.data.object.status` straight into the column with no
translation step to get wrong, and a future read of this table means exactly
what Stripe's own dashboard would show for the same subscription.

`subscription_records.status` is therefore `CHECK (status IN ('incomplete',
'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled',
'unpaid', 'paused'))`, default `'incomplete'` — the state a row is created
in by *this part's* checkout-session creation, before Stripe Checkout has
ever completed (mirrors `payment_records.status` defaulting to `'pending'`
for the identical reason: a session that might still be abandoned).

The state machine part 2's webhook handler will need to implement against
this column (documented here so the table shape is provably sufficient for
it, not because this PR implements any of these transitions):

```
incomplete ──(checkout completes, no trial)──────────────► active
incomplete ──(checkout completes, trial configured)──────► trialing
incomplete ──(checkout abandoned / payment method fails)─► incomplete_expired  [terminal]
trialing   ──(trial ends, first invoice paid)────────────► active
trialing   ──(trial ends, first invoice fails)───────────► past_due
active     ──(invoice.payment_failed)────────────────────► past_due
past_due   ──(invoice.paid, dunning recovers)────────────► active
past_due   ──(dunning exhausted / Smart Retries give up)─► canceled or unpaid [terminal-ish]
active/past_due/trialing ─(customer.subscription.deleted)► canceled  [terminal]
any        ──(paused via Stripe's own pause_collection)──► paused
```

`current_period_end` (nullable timestamptz), `cancel_at_period_end` (boolean,
default false) and `canceled_at` (nullable timestamptz) exist on the table
now so part 2 has somewhere to write `customer.subscription.updated`'s
`current_period_end`/`cancel_at_period_end` and `customer.subscription.
deleted`'s timestamp without a second migration — populated by nothing this
PR ships (every new row's `current_period_end`/`canceled_at` stay `NULL` and
`cancel_at_period_end` stays `false` until part 2's webhook handler exists).
`stripe_subscription_id` and `stripe_customer_id` are nullable for the same
reason `payment_records.stripe_payment_intent_id` is: unknown at
checkout-session-creation time (a subscription object doesn't exist until
Checkout completes), resolved only once a real webhook or the dev-advance
equivalent runs — again, part 2's job to populate, this PR's job to make
sure the column exists to receive it.

### 3. Where a subscription record lives

**Decision: its own table, `subscription_records`, sibling to
`payment_records`, not new columns on it.** Reasoning is the same "would
grow five permanently-unused columns on every one-off row, and blur two
different-shaped lifecycles into one CHECK constraint" argument from
question 1 — restated here because the card asks it as a separate question,
but it's the same underlying answer: one-off and recurring are different
enough operationally (write-once vs. write-indefinitely, three states vs.
eight, no ongoing Stripe relationship vs. one that needs renewal/dunning/
cancellation webhooks) that forcing them into one table would cost real
clarity for a `payment_records` row-shape that has worked fine, unchanged,
since Slice 10. `subscription_blocks` mirrors `payment_blocks` for the
identical publish-snapshot reason 0009_slice10_payments.sql's own header
comment gives: the runtime's checkout endpoint has no authenticated tenant
context and must resolve a blockId to a siteId and a *trusted* price/
interval/trial without ever taking them from a visitor's own request.

`stripe_connections` (the tenant's OAuth grant) is **reused as-is, not
duplicated** — a connected Stripe account is the same account regardless of
whether it's charged once or on a schedule, and `CreateSubscriptionCheckoutSession`
takes the identical `accessToken`/`stripeAccountId` shape
`CreateCheckoutSessionInput` already does.

### New migration

`packages/db/migrations/0012_kan1154_subscriptions.sql` (`0011` — scroll-reveal
— is the highest existing number). Two new tables, `subscription_blocks` and
`subscription_records`, RLS shaped identically to `payment_blocks`/
`payment_records` (tenant-isolation policy on both, plus a public-read policy
on `subscription_blocks` only, for the same "runtime resolves a blockId with
no signed-in principal" reason `payment_blocks_public_read` exists). No
change to any existing table or existing row.

## Decision (summary)

1. **Distinct block type** `subscription` — new schema, new component, zero
   changes to the existing `payment` block/schema/component/tables/routes.
2. **Stripe's own subscription status vocabulary, stored verbatim** in
   `subscription_records.status`, not a platform-invented projection —
   removes a translation step part 2 would otherwise have to get right with
   no live account to verify against.
3. **A new sibling table pair** (`subscription_blocks`, `subscription_records`),
   not new columns on `payment_blocks`/`payment_records` — keeps the
   working one-off shape untouched and avoids a permanently-partial row
   shape on either table.
4. **This part builds creation only**: the block, the schema, the migration,
   and a `mode: "subscription"` Checkout-session-creation path through
   `TenantStripeProvider`/`packages/runtime/src/checkout.ts`'s equivalent
   port. It does **not** implement `invoice.paid`/`invoice.payment_failed`/
   `customer.subscription.deleted` webhook consumption, any dunning/retry
   behavior, or any owner/visitor-facing subscription-management UI — those
   are part 2, against the table and state machine this ADR designs.

## Consequences

- A tenant can offer a `subscription` block on a page once part 1 ships, and
  a visitor can start a subscription Checkout session and be redirected to
  Stripe. Until part 2 ships, **that subscription's status in
  `subscription_records` never changes on its own** — it is created
  `'incomplete'` and stays there even after the visitor completes payment on
  Stripe's side, because nothing consumes the webhook yet. This is a known,
  called-out gap (see the PR body), not a bug to chase down in this PR.
- Two Payment-shaped blocks now exist in the block library (`payment`,
  `subscription`) with genuinely different props and genuinely different
  backing tables — an editor/owner sees two separate block types in the
  canvas, not one block with a hidden mode switch. This is the intended
  trade-off: clarity over a smaller block count.
- `subscription-blocks.ts`/`subscription-records.ts` (`@prefab/db`),
  `apps/api/src/lib/subscription-adapters.ts`, and `apps/self-host/src/
  subscription-adapters.ts` (+ its own `lib/tenant-stripe.ts` sibling method)
  are new files, not new branches in existing ones — mirrors how
  `payment-adapters.ts` itself is a new file next to `booking-adapters.ts`,
  not a branch inside it.
- No new control-plane mutation surface, and so no new CLI/MCP command:
  starting a subscription checkout is a **runtime** mutation (no signed-in
  principal — a visitor, not an owner), the identical reasoning
  `apps/api/src/mutations.ts`'s own comments already give for why
  `booking.create`/`submission.create`/`eventSignup.create`/the existing
  one-off `payment-blocks/:blockId/checkout` are all absent from
  `API_MUTATIONS` — invariant 1's three-surface-parity rule governs
  control-plane mutations, and this isn't one.

## Rejected

**Reusing `payment`'s schema with `amount` reinterpreted as "per-interval"
when `interval` is set.** Rejected in question 1 above: it's a silent
meaning-change on an existing, shipped field (needs a version bump/migration
either way, per `docs/BLOCK_CONTRACT.md`'s own versioning rule), and it
forces every reader of `payment` props to branch on whether this particular
instance is secretly recurring before trusting what its own fields mean.

**Adding `interval`/`price` as new, always-optional fields on the existing
`payment` block, with `amount`+`interval` both present meaning "recurring"
and `amount` alone meaning "one-off."** A smaller schema diff than a new
block type, but it reintroduces exactly the conditional-validation problem
question 1 describes, and it means every one-off payment ever created before
this feature existed now has two new optional columns/props it will never
use — visible clutter on the one code path (one-off payments) this card
explicitly says must stay byte-identical.

**A platform-invented subscription status enum** (e.g. `active`/`past_due`/
`canceled` only, collapsing Stripe's eight states into three). Rejected in
question 2: fewer states looks simpler until part 2 has to decide where
`trialing`/`incomplete`/`paused`/`unpaid` each collapse to, with no live
account to validate the mapping against — storing Stripe's own vocabulary
verbatim removes that translation step and its failure mode entirely.

**Growing `payment_records` with subscription-lifecycle columns instead of a
new table.** Rejected in question 3 for the same reason a distinct block
type was chosen in question 1: every existing one-off row would carry five
permanently-NULL/default columns forever, and every existing reader of that
table would need to keep ignoring them.

## Addendum (part 2, KAN-1154): resolving `siteId` for post-checkout events

Part 1 above builds Checkout-session creation only and explicitly leaves
"part 2's webhook handler" the job of consuming `checkout.session.completed`
and every subsequent lifecycle event. Part 2 (this addendum) implements
that consumer (`apps/api/src/lib/subscription-webhook.ts`,
`apps/self-host/src/subscription-webhook.ts`, and the extended
`/v1/webhooks/stripe-connect` route + dev-advance route in both `app.ts`
files) exactly against the state machine and column shape this ADR already
designed — no schema change, no new migration. This addendum records the
one real design decision part 2 itself had to make, per the card's own
framing of it as a two-option choice.

### The problem

`checkout.session.completed` resolves `siteId` the same way the one-off
payment webhook always has: `client_reference_id`/`metadata.siteId`,
threaded through at Checkout-session-creation time
(`CreateSubscriptionCheckoutSessionInput`, part 1). But every subsequent
lifecycle event — `invoice.paid`, `invoice.payment_failed`,
`customer.subscription.updated`, `customer.subscription.deleted` — arrives
with **no Checkout Session context at all**. An invoice event carries a
reference to its subscription; a subscription event *is* the subscription.
Neither carries `client_reference_id`, because neither is a Checkout
Session. `subscription_records` is RLS-keyed on `site_id` (R20) exactly
like `payment_records`, so the webhook handler must resolve `siteId`
*before* it can touch the table at all — the identical constraint part 1's
own `CreateCheckoutSessionInput` comment already documents for the first
event, now facing every event after it with no session to fall back on.

### Two options, and which this part took

**(a) — chosen: set `subscription_data[metadata]` on the Checkout Session
at creation time**, so Stripe copies `siteId`/`subscriptionRecordId` onto
the *Subscription* object itself once the session completes. A Subscription
carries its own `.metadata` at its own top level for the rest of its life —
`customer.subscription.updated`/`.deleted` read it directly off
`event.data.object.metadata`. An Invoice references its subscription (and,
depending on API version, a mirror of that subscription's metadata) via
`invoice.subscription`/`invoice.subscription_details` (or, on the
2025-03-31+ restructure, `invoice.parent.subscription_details`) — see
`extractSubscriptionEventContext` (both `apps/api`/`apps/self-host` copies)
for the defensive, more-than-one-shape read this repo's own "UNVERIFIED, no
live account" constraint requires.

**(b) — rejected: resolve `stripe_subscription_id` -> `site_id` via a
lookup query that runs before tenant context is set.** This repo's RLS
policy shape is `USING (site_id = current_setting('app.site_id', true))`
(every migration since 0001) — every existing query in this codebase either
already has `siteId` in hand before it ever calls `withTenantContext`, or
gets it from exactly the mechanism (a) uses (Checkout's own
`client_reference_id`/`metadata`, e.g. the one-off payment webhook, Slice
8's billing webhook's `client_reference_id`-carries-`accountId` for its own
`checkout.session.completed`). There is no existing "look up which tenant a
row belongs to with no tenant context set yet, using a non-`site_id` key"
query anywhere in this codebase to extend — building one for this part
alone means either a `SECURITY DEFINER` function or a superuser-role
bypass-RLS read path, both meaningfully more surface (a new RLS-adjacent
trust boundary to reason about and keep correct) than asking Stripe to echo
back an identifier it already has a documented field for. (a) needs no new
query shape, no new trust boundary, and no live account to get right beyond
what part 1 already committed to being UNVERIFIED about.

### Idempotency mechanism (point 4 of the card)

Two independent layers, not one:

1. **Exact redelivery** (Stripe retries any event it didn't get a fast 2xx
   for — the same `event.id` twice): guarded by `recordStripeWebhookEvent`,
   reusing Slice 8's own `stripe_webhook_events` table
   (`packages/db/migrations/0007_slice8.sql`) unchanged — Stripe event ids
   are globally unique regardless of which integration receives them, so
   this needed no new table in `apps/api`. `apps/self-host` had no such
   table at all before this part (it had no real webhook consumer of any
   kind — see below); `schema.sql` now carries an identical
   `stripe_webhook_events` table for the same reason.
2. **Out-of-order / different-event-id delivery** (a delayed `invoice.paid`
   arriving after a *later* `customer.subscription.deleted` already set
   `status = 'canceled'`): guarded by `updateSubscriptionLifecycle`'s own
   `fromStatuses` parameter — every transition only ever fires from the
   state machine's own documented predecessor set, so a transition whose
   precondition the row's current status no longer satisfies matches no
   row and is silently skipped (no write, no notification). This is the
   layer redelivery-dedup alone cannot provide: two *different* event ids
   delivered out of order are not duplicates by id, but one of them must
   still lose, and `checkout.session.completed` -> `active`/`trialing` is
   additionally guarded to fire only from `'incomplete'`, the identical
   discipline `updatePaymentRecordStatus`'s own `AND status = 'pending'`
   guard already uses for the one-off path.

### Self-host parity, verified concretely

`apps/self-host` had **no real webhook consumer of any kind** before this
part — not for subscriptions, and not for the existing one-off payment path
either (confirmed by reading `apps/self-host/src/app.ts` in full: only
`/v1/dev/stripe-connect/advance`, the dev-only simulate route, existed).
This part adds `/v1/webhooks/stripe-connect` to `apps/self-host` for the
first time, scoped to subscription lifecycle events only — the pre-existing
one-off payment webhook gap is untouched and out of this card's scope, left
for a future card to close symmetrically if desired.
