# ADR-0018: Product catalogue — a distinct collection, `fulfillmentType` designed in now

- **Status**: Accepted
- **Date**: 2026-09-06
- **Fork**: KAN-1244 (part 1 of 4, EPIC-178 — Milestone 3, E-commerce / storefront blocks)

## Context

Milestone 3 adds a storefront to pre-fab: an owner lists products, a visitor
adds them to a cart and checks out (bring-your-own Stripe, same trust model
as ADR-0005/ADR-0016), and the owner fulfills the order. That is four cards'
worth of work. This card (KAN-1244) builds only the catalogue itself — the
`products` collection, `productGrid`/`productDetail` blocks, and full
API/CLI/MCP parity to manage it — and, per the card's own instruction, writes
up the decisions that shape every later card *before* building, the same
discipline ADR-0014 and ADR-0016 already followed for their own cards.

Four questions, same as the card frames them.

### 1. A distinct `products` collection, or reuse `posts`?

`posts` (Slice 5, `packages/schema/src/post.ts`) already gives pre-fab a
collection with exactly the shape a catalogue seems to want at first
glance: its own table, its own slug, a title/body, a draft/published
status, and — the actual reason to look here first — the identical
optimistic-concurrency write discipline (ADR-0006/R17) every mutation in
this repo gets. If a product were just "a post with a price," reusing the
table would mean one less migration and one less repository file.

It isn't, for two independent reasons:

**A product's own fields have no analogue in `PostDocumentSchema`, and
forcing them in would repeat the exact shape ADR-0016 rejected for
`payment`/`subscription`.** A post's fields (`date`, `author`, `tags`,
`cover`, `locale`) describe editorial metadata; a product needs `price`
(cents, server-resolved, the same "never trust a visitor's own request"
discipline `PaymentPropsSchema.amount` already documents), `currency`,
`images` (plural — a product listing needs more than one photo, a post's
single `cover` doesn't fit), and `fulfillmentType`/`stockCount` (see
question 2) — none of which describe a blog post, and none of which a blog
post's own reader (RSS/sitemap generation, `PostList`/`PostDetail`) has any
business seeing. Bolting a `price`/`stockCount` onto `posts` means every
existing post row grows columns it will permanently NULL, and every
existing reader of `posts` (feeds.ts's RSS generator, the two blog blocks)
has to keep ignoring them — the identical "conditional field bag on a
working shape" cost ADR-0016 already paid down once and explicitly decided
not to pay again.

**A post's own visibility rule doesn't transfer.** `isPostVisible` gates on
`status === "published" AND date <= today` — a post's `date` is both its
displayed date and a scheduling gate. A product has no publish-date concept
at all (a shop doesn't "schedule" a product for a future calendar date the
way a blog schedules a post); its own gate is simpler: `status ===
"published"`, full stop. Reusing `isPostVisible` unmodified would silently
require every future product to carry a meaningless `date` field just to
satisfy a gate designed for different content; a separate `isProductVisible`
is one line, and it's the *correct* one line, not a workaround.

**Decision: `products` is its own collection** — own schema
(`packages/schema/src/product.ts`), own file-tree projection
(`product-file.ts`), own table (`packages/db/migrations/0013_kan1244_
products.sql`), own repository (`packages/db/src/repositories/
products.ts`), following `posts`' own chain file-for-file (schema →
migration → repository → commands → API → CLI → MCP → blocks → editor
panel → export/eject/build), per the card's own instruction — not because
mirroring is a goal in itself, but because a second collection with a
proven shape is cheaper to get right than a shared shape stretched to cover
two different kinds of content.

### 2. `fulfillmentType`: designed in now, even though its logic isn't built until card 3

The card is explicit that shipping and inventory-decrement logic are card
3's job, not this one. It would be simpler for *this* card to ship a
product with just `price`/`stockCount` and let a later card decide how
fulfillment branches. That was rejected for the same reason ADR-0016 chose
to store `trialPeriodDays` now rather than reopen its schema for it later:
**a field that changes what "the rest of the fields mean" is not safe to
add after the fact.**

Concretely: a product's `stockCount` and shipping requirement mean
completely different things depending on whether it's a physical good or a
digital/service good. A physical product's `stockCount` is a real,
decrementable inventory count that must reach zero before the product stops
selling, and its checkout (card 2) must collect a shipping address. A
digital/service product has no inventory to run out of — the card's own
words are "auto-delivered on payment" — and collecting a shipping address
for it would be actively wrong, not just unnecessary. If `fulfillmentType`
were added by card 3 instead of now:

- Every product created between this card and card 3 would need its
  `fulfillmentType` **backfilled** — a real migration touching every
  existing row, not a new column with a safe default, because there is no
  correct default that applies to a product nobody described as physical or
  digital at creation time.
- `productDetail`'s add-to-cart button (this card's stub) and card 2's real
  checkout would need to re-derive "does this require shipping" from
  whatever card 3 eventually invents, rather than reading a field that's
  been true since the product was created.
- The owner-facing catalogue panel (this card) would have no way to let an
  owner even *say* "this is a digital download" until card 3 shipped —
  meaning every physical-goods assumption (a stock count that means
  inventory, an add-to-cart flow that implies "will be shipped") would be
  baked into the UI's copy and validation now, and require its own rework
  later.

None of that is hypothetical difficulty — it's the exact "renamed field /
changed unit" concern `docs/BLOCK_CONTRACT.md`'s Versioning section already
flags for a shipped schema, applied to a whole-document field instead of a
block prop.

**Decision: `fulfillmentType: "physical" | "digital_or_service"` is part of
`ProductDocumentSchema` from this card**, defaulting to `"physical"` (the
common case a catalogue block library ships with, same "sensible common
case" reasoning `PostStatusSchema` defaults to `"draft"`). Whole-document
validation (`validateProductDocument`) enforces the pairing this field
implies, the same "reject wholesale, name every problem" discipline
`validatePostDocument`'s own comment describes:

- `fulfillmentType: "physical"` requires `stockCount` to be a non-negative
  integer (never `null`) — a physical product without a stock count is a
  product nobody has told the truth about yet.
- `fulfillmentType: "digital_or_service"` requires `stockCount` to be
  `null` — there is nothing to run out of, and a stray number here would
  read as inventory to a future reader that doesn't exist.

This is a deliberate ergonomic friction, not an oversight: creating a
digital/service product means explicitly writing `stockCount: null`, not
getting a silently-ignored default. A field that means two different things
depending on another field is exactly the shape this ADR is trying to keep
out of the schema (see question 1) — the friction of an explicit,
type-checked pairing is cheaper than a `stockCount` that quietly means
nothing for half of all products.

`needsShipping` is deliberately **not** a separate stored field —
`fulfillmentType === "physical"` already says it, unambiguously, and a
second field that has to agree with the first forever is the identical
"two things that must be kept in sync by hand" cost this ADR is arguing
against elsewhere. Card 3 derives "does this order need a shipping flow"
from `fulfillmentType` directly.

`successMessage` (default `"Thank you for your purchase."`) is the field
the card calls out by name — "a `successMessage`-like field on the product
itself, shown after checkout" — modelled directly on
`PaymentPropsSchema.successMessage`/`SubscriptionPropsSchema.
successMessage`. It is stored on every product, not only digital/service
ones (simpler schema, and a physical product benefits from an
owner-configurable thank-you message too), but the card's framing —
"auto-delivered on payment" — is specifically about the digital/service
case, where this message is the *entire* fulfillment experience with no
shipping step to follow it. Nothing in this card renders it after a real
checkout (there is no checkout yet); it exists now for the same reason
`trialPeriodDays` did in ADR-0016 — so card 2 has a field to read instead
of a schema migration to write.

### 3. Single-SKU only — no variants

Already settled with the user before this ADR was written (per the card).
Recorded here because it shapes the schema: `ProductDocumentSchema` has one
`price` and one `stockCount`, not a `variants: Variant[]` array each with
its own price/stock/SKU. A variant model (size × color, each with its own
inventory) is a materially bigger schema — every variant needs its own
stock count, its own optional price override, its own selection UI in
`productDetail`, and its own line-item identity in a future cart/order
(card 2/3's tables would need to reference a variant id, not just a product
id). None of that is needed to ship a working catalogue, and building it
speculatively now would mean guessing at a shape cards 2-4 haven't asked
for yet. Deferred to a later milestone, called out explicitly so a future
reader doesn't mistake `stockCount`'s singular shape for an oversight.

### 4. Products live in the exportable site tree; orders will not

`posts`, `pages`, and now `products` are all **owner-authored catalogue/
content** — the owner decides what a product is called, what it costs, what
its photos are, and that decision belongs to the site the same way a blog
post does. Slice 5's posts already established the precedent
(`packages/commands/src/commands/{export-bundle,eject,pull,push}.ts`'s
`allPosts` pagination helper, `posts/${slug}.md` in a checkout) — this card
extends the identical mechanism to products: `allProducts`, `products/
${slug}.md`, `ProductDocument[]` threaded through `buildSiteBundle`/
`ejectSite` exactly where `PostDocument[]` already is.

Orders (card 3) are not catalogue content — an order is a *record of an
event that happened to one specific site's one specific customer*: what
they bought, what they paid, their shipping address, whether it shipped.
That is exactly the shape R20 and every existing platform-only table
(`submissions`, `bookings`, `payment_records`, `subscription_records`)
already draws the line at: visitor/customer PII and transactional state
never belong in a tree designed to be exported, diffed, and committed to a
customer's own git repository (ADR-0008's "no secrets and no visitor PII in
a site source tree" invariant, restated in CLAUDE.md's own invariant 5).
Conflating the two — as the card explicitly warns against — would mean a
site export carrying every customer's name and shipping address forever,
the one thing this repo's whole file-tree-projection design (ADR-0002)
promises never happens.

**Decision**: `products` ships in this card as exportable, portable site
content, following posts' exact precedent. Orders and stock-mutation state
(cards 3-4) get their own platform-only table(s), RLS-isolated the same way
`payment_records`/`bookings` already are, with no file-tree projection and
no path in `export-bundle`/`eject`/`pull`/`push` — the same "designed in
from the start, not bolted on when someone almost got it wrong" discipline
this ADR's question 2 already argues for.

## Decision (summary)

1. **A distinct `products` collection** — own schema, migration, repository,
   file-tree projection — mirroring `posts`' precedent file-for-file rather
   than growing `posts` with e-commerce fields.
2. **`fulfillmentType: "physical" | "digital_or_service"`**, defaulting to
   `"physical"`, is part of the schema from day one. Whole-document
   validation enforces `stockCount`'s meaning against it (a required
   non-negative integer for physical, required `null` for digital/service)
   rather than leaving the pairing to be enforced (or forgotten) by a later
   card.
3. **Single-SKU only** — one `price`, one `stockCount` per product.
   Variants (size/color) are explicitly deferred to a later milestone.
4. **Products live in the exportable site tree** (schema → migration →
   repository → commands → API → CLI → MCP → blocks → editor panel →
   export/eject/build, the same chain as posts). **Orders will not** — they
   are platform-only, RLS-isolated, customer-PII-bearing records, built by
   card 3 against their own migration.
5. **New blocks `productGrid`/`productDetail`**, following `postlist`/
   `postdetail`'s exact build-time-injection pattern
   (`packages/publish/src/page-template.ts`'s `getStaticPaths`): a page
   carrying `productDetail` becomes a per-product route template; a page
   carrying `productGrid` paginates over the site's products. Neither block
   makes a runtime fetch or hydrates with `client:load` — `productDetail`'s
   add-to-cart button is a static, disabled stub (cart state and checkout
   are card 2's scope, not this card's).
6. Reuses the existing sha256 content-addressed asset upload
   (`apps/api/src/lib/asset-storage.ts`) for product images — `images` is
   modelled as `string[]` (asset URLs), the same "plain URL string, no new
   asset concept" pattern `image`/`gallery` block schemas already use.

## Consequences

- An owner can create, list, and edit products through the API, CLI, MCP,
  and a new editor panel (`ProductsPanel.tsx`, cloned from `BlogPanel.tsx`'s
  structure) as soon as this card ships — the same three-surface parity
  every other mutation in this repo gets (ADR-0003, CI-enforced via
  `ci:parity`).
- `productGrid`/`productDetail` can be placed on a page and will render real
  products once published, with pagination and per-product routes
  identical in shape to `postlist`/`postdetail`.
- Clicking "Add to cart" on a published `productDetail` page does nothing
  yet — it is a visible, disabled stub, not wired to any endpoint. This is
  intentional, not a bug: cart state and checkout are card 2's scope.
- `stockCount` is stored and owner-editable, but nothing in this card
  decrements it, transitions any order/fulfillment status, or enforces
  "sold out" at checkout (there is no checkout). `productGrid`/
  `productDetail` read it only to show an "Out of stock" indicator for a
  physical product at `stockCount <= 0` — a read-only display of
  owner-set state, not inventory management.
- Exporting or ejecting a site now includes `products/*.md` alongside
  `posts/*.md` — a customer's portable export grows a new file-per-product,
  consistent with the "hand over a working site" promise this whole project
  is built around.
- No new control-plane mutation surface beyond `product.create`/
  `product.write` (list/get are non-mutating reads, same as `post.list`/
  `post.get`) — no runtime-facing route exists yet, because nothing a
  visitor does (browsing a catalogue) mutates anything in this card.

## Rejected

**Reusing `posts` with e-commerce fields bolted on.** Rejected in question
1: a product's fields (`price`, `currency`, `images[]`,
`fulfillmentType`/`stockCount`) have no analogue in a blog post, forcing
every existing post row to carry permanently-unused columns and every
existing reader of `posts` (RSS/sitemap, the two blog blocks) to keep
ignoring them — the same cost ADR-0016 already declined to pay for
`payment`/`subscription`.

**Deferring `fulfillmentType` to card 3, shipping only `price`/`stockCount`
now.** Rejected in question 2: `stockCount`'s meaning depends entirely on
whether a product is physical or digital, and adding that distinction later
means backfilling every product created in the meantime with no correct
default to backfill it with — the identical "silent meaning-change on an
already-shipped field" problem ADR-0016 rejected for `payment.amount`.

**A `needsShipping` boolean stored alongside `fulfillmentType`.** Redundant
with `fulfillmentType === "physical"` — two fields that must always agree
is worse than one field a reader derives the same fact from, the identical
reasoning against a platform-invented status enum in ADR-0016.

**Variants (size/color) in this milestone.** Already settled with the user
before this ADR was written; recorded here for why the schema is singular
(`price`, `stockCount`) rather than an array — see question 3.

**Modelling `images` as asset ids requiring a join, instead of plain URL
strings.** Rejected for consistency with the existing `image`/`gallery`
block schemas, both of which already model a picked image as a bare URL
string rather than a foreign key into `assets` — introducing a different
convention for products alone would mean two ways to reference an uploaded
image in the same block library, for no benefit this card's scope needs.

## Note for cards 2-4

This ADR covers catalogue content only. It deliberately does **not** design:

- Cart state, session/anonymous-visitor identity, or checkout
  (Stripe Checkout session creation, success/cancel handling) — card 2's
  scope. Expect its own ADR addendum, the same way ADR-0016's own part 2
  added an addendum for its webhook consumer rather than revising this
  document's own decisions after the fact.
- Orders, an order's own lifecycle/status vocabulary, inventory
  decrement, or an order-management dashboard — card 3's scope. `stockCount`
  exists on `ProductDocument` today specifically so card 3 has a column to
  decrement without a second migration, the same reasoning ADR-0016's
  `current_period_end`/`cancel_at_period_end`/`canceled_at` existed on
  `subscription_records` before any code populated them.
- Self-host runtime changes of any kind — card 4's scope, once cards 2-3
  have settled what the runtime actually needs to serve.

Whoever picks up card 2 should read this ADR's question 2 before touching
`fulfillmentType` — the fields it depends on (`stockCount`'s nullability,
`successMessage`) are already load-bearing for what card 2 builds, not
placeholders to redesign.

## Addendum (part 2, KAN-1245): cart, multi-item checkout, shipping

Part 1 above built the catalogue only and explicitly left "cart state,
session/anonymous-visitor identity, or checkout" to this card, with its own
ADR addendum expected — the same shape ADR-0016's own part-2 addendum
followed. This addendum covers: the one open design question part 1's own
migration deliberately left unresolved (a public-read policy on `products`),
the multi-item Checkout session this card builds, the shipping/no-shipping
branch, and the completion-metadata shape KAN-1246 (part 3, the webhook
consumer and order creation) will read.

### 1. Products' checkout-time read: a scoped public-read policy on the live table, not a snapshot

Part 1's migration named the fork explicitly: mirror
`payment_blocks_public_read` (a context-free read on an immutable,
publish-time snapshot), or design something else, because `products` is not
a snapshot the way `payment_blocks`/`subscription_blocks` are — `price` and
`stockCount` are live, owner-editable, and `stockCount` specifically is
about to become the thing this milestone's whole "never trust the client
for money" checkout re-validates on every request (KAN-1246 decrements it on
a completed order; this card's own `createCartCheckout` already rejects a
cart against the current count, not whatever the visitor's page happened to
render).

**Decision: add `products_public_read`, scoped to `status = 'published'`,
directly on the live `products` table** — not a new snapshot table, and not
`USING (true)` the way `payment_blocks_public_read` is:

```sql
CREATE POLICY products_public_read ON products
  FOR SELECT USING (status = 'published');
```

Why the live table and not a snapshot: `payment_blocks`/`subscription_blocks`
exist specifically because a Payment/Subscription block's amount must never
drift between "what the page showed" and "what checkout charges" — the
snapshot **is** the fix for that problem. A product snapshot would
reintroduce the exact problem this milestone is trying to solve one level
up: a snapshot taken at publish time would still show the stock count as it
was *when the site was last published*, not *right now* — the whole reason
`createCartCheckout` re-reads `products` instead of trusting the cart's own
denormalized display data. A live read is not a compromise here; it is the
requirement.

Why scoped to `status = 'published'` and not `USING (true)`: a
`payment_blocks` row has no "draft" concept to worry about — every row that
exists was already placed on a published page. A `products` row can sit in
`'draft'` status indefinitely, and its id is not secret (it appears in owner
API responses, catalogue exports, browser history for a preview link). An
unscoped `USING (true)` would let a visitor who obtains a draft product's id
(a leaked preview URL, a guessed sequential-looking id, a scraped API
response from a misconfigured integration) add it to a cart and complete a
real Stripe charge for a product the owner never intended to sell — the
exact failure mode `isProductVisible`/`isPostVisible` already exist to
prevent everywhere else a product/post is shown to a visitor. Scoping the
policy's own `USING` clause to `status = 'published'` makes an unpublished
product genuinely unreadable with no tenant context, not just
unreadable-by-convention (i.e. "the API happens not to expose it") — the
same "the database is the last line of defense" posture
`products_stock_count_matches_fulfillment_type`'s CHECK constraint already
takes in part 1's own migration.

Mechanically this is two permissive RLS policies on one table
(`products_tenant_isolation` from part 1, unchanged, and this new
`products_public_read`), OR'd together by Postgres exactly like
`payment_blocks_tenant_isolation`/`payment_blocks_public_read` already are —
an owner's own authenticated read (tenant context set) still sees every
status; a context-free runtime read sees published rows only. `getProduct`
(part 1, no site-scoping in its own query — RLS does the scoping) is reused
unchanged for the owner-authenticated path; a new `getProductPublic`
(mirrors `getPaymentBlockPublic` field-for-field: "relies entirely on the
public-read policy, call with `withTenantContext(pool, {})`") is added for
the runtime path. `createCartCheckout` additionally checks
`product.siteId === input.siteId` after the read — the public-read policy
has no site scoping of its own (it can't: there's no tenant context to scope
against), so a productId belonging to a different site would otherwise read
successfully. A mismatch is treated identically to "not found" — surfacing
"this product exists, just not on your site" would leak cross-tenant
existence information for no benefit to a legitimate caller.

### 2. A new `cart_checkout_records` table, not a branch on `payment_records`

`payment_records`/`subscription_records` both carry `block_id NOT NULL
REFERENCES payment_blocks/subscription_blocks` — a cart checkout has no
block at all (a cart spans however many `productDetail`-listed products a
visitor chose, off the page entirely, from a mini-cart that can be placed on
any page or none). Reusing either table would mean making `block_id`
nullable on a table whose one existing index/FK assumes it never is, for a
row shape (`items` plural, no single `amount`) neither existing table
represents. This is the identical "second, sibling table, not a branch on a
working one" call ADR-0016 already made for `subscription_records` vs
`payment_records` (question 3 of this same ADR chain) — a cart checkout is
its own kind of thing, not a payment with an optional block.

`cart_checkout_records` (`0014_kan1245_cart_checkout.sql`) mirrors
`payment_records`'s shape: platform-only, RLS tenant-isolated, no public
read (a cart checkout's own record carries the same visitor-PII-adjacent
shape — buyer email once known — R20 already draws this line for
`payment_records`/`bookings`/`submissions`). `items` is stored as `jsonb`,
written once by `createCartCheckout` **before** the Stripe API call — every
field in it (`unitAmount`, `currency`, `title`, `fulfillmentType`) is
already server-resolved by that point (this card's own re-validation
against the current `products` row), never the visitor's cart's own
denormalized display copy. `status` defaults to `'pending'` and this card
writes nothing else to it — mirrors `subscription_records`' own precedent
exactly ("`current_period_end`/... existed on `subscription_records` before
any code populated them"): the column exists so KAN-1246's webhook consumer
has somewhere to transition into (`'completed'`/`'failed'`) without a second
migration, but no `updateCartCheckoutRecordStatus` function is added by this
card — there is no webhook consumer yet to call it.

### 3. Multi-item Checkout session shape

`TenantStripeProvider.createCartCheckoutSession` (new method,
`createCheckoutSession`/`createSubscriptionCheckoutSession` untouched)
builds one `line_items[N]` per validated cart line
(`price_data[currency]`/`price_data[product_data][name]`/
`price_data[unit_amount]`/`quantity`, indexed 0..N-1) — the direct
generalization of `createCheckoutSession`'s single hard-coded
`line_items[0]` to however many lines a cart resolves to, `mode: "payment"`
only (no subscription products in a cart this milestone, already settled
with the user). Every field going into those line items comes from
`createCartCheckout`'s own re-validated line items
(`CartCheckoutSessionLineItem`), never from the request body — the visitor's
request supplies only `{productId, quantity}` pairs; the server resolves
`unitAmount`/`currency`/`title` from the current `products` row on every
call, the identical "block/manifest resolves money, request never does"
discipline `createPaymentCheckout`/`createSubscriptionCheckout` already
established, generalized from one line item to N.

**Duplicate `productId` entries in one request are merged (quantities
summed), not rejected and not left to produce two Stripe line items for the
same product.** A visitor's own cart-building client code is the only thing
that could produce this (this repo's own `useCart` hook keeps one entry per
product, merging on add), but the server doesn't trust that either — a
request replayed or hand-built with `[{p1,2},{p1,3}]` becomes one
`{p1,5}` line, matching what a single deduped cart would have sent.

**A cart whose resolved products don't all share one currency is rejected**
(`status: "mixed_currency"`) rather than charged. Stripe Checkout Sessions
price every line item in one session-level currency; there is no per-line
currency in a single Checkout Session the way there could be per-product
currency in this repo's own catalogue (a site's products each carry their
own `currency` field, part 1's schema, with no constraint that every product
on one site shares one). Converting between currencies, or splitting one
cart into several same-currency Checkout Sessions, is real feature work with
its own UX questions (which session does the visitor complete first? what
happens if only one succeeds?) that nothing in this card's brief asked for —
deferred, and surfaced to the visitor as a clear rejection rather than a
silent wrong charge. In practice this only matters for a site whose owner
has actually set different currencies on different products, which none of
this repo's own templates do today.

### 4. Shipping: owner-configured flat rate, server-side only — not visitor-supplied, not yet a per-site setting

The card's own brief says "owner-configured flat-rate `shipping_options`."
This addendum implements the flat rate and country allow-list as a single
**platform-level, environment-configured default**
(`CART_SHIPPING_FLAT_RATE_CENTS`/`CART_SHIPPING_LABEL`/
`CART_SHIPPING_ALLOWED_COUNTRIES`, wired into `CreateCartCheckoutDeps.shipping`
by apps/api, with a sensible built-in fallback), not a true
per-site owner setting with its own storage, API/CLI/MCP surface, and
editor UI. Two reasons, both about not silently widening this card's own
scope:

- A real per-site shipping-rate setting is a **mutation** (an owner sets
  it), which R12/ADR-0003 requires a full API + CLI + MCP surface for (the
  same three-surface parity `product.create`/`product.write` already have) —
  building that is easily as much work as the cart/checkout half of this
  card, and nothing in the card's own "New cart UI" list or "your two
  deliverables" asks for an owner-facing shipping settings screen.
- The money-trust reasoning that already governs every other field here cuts
  the same way: whatever the shipping amount/allowed countries turn out to
  be, they must **never** come from the visitor's own request (the same
  "never trust the client for money" `PaymentPropsSchema.amount`'s own
  comment already establishes) — the request body this card defines
  (`{items}` only, see point 5) does not carry a shipping selection or an
  allowed-countries list at all, so there is nothing for a real per-site
  setting to slot into yet without also touching that body shape.

This is a deliberate, named simplification, not a silent gap: a genuine
per-site shipping-rate setting (its own table, its own
`shipping.configure`-shaped mutation, its own owner-facing panel) is left for
a future card, exactly the way part 1 named variants/tax as deferred rather
than pretending they were out of scope by omission.

Branching logic, in `createCartCheckout`: `requiresShipping =
validatedItems.some(item => item.fulfillmentType === "physical")`, computed
from the server-re-validated items (never the cart's own client-side
`fulfillmentType` snapshot, which exists only for the mini-cart's own
display). When true, `createCartCheckoutSession` sets
`shipping_address_collection[allowed_countries][0..]` and
`shipping_options[0][shipping_rate_data][type/fixed_amount/display_name]`
from `deps.shipping`; when false (every item digital/service), neither field
is sent at all — Stripe Checkout collects no address and offers no shipping
option, matching the card's own "digital/service-only carts skip shipping
collection entirely."

### 5. The request body: no `successUrl`/`cancelUrl`/`shippingCountries` from the visitor

The card's own brief suggested a body of `{items, successUrl, cancelUrl,
shippingCountries?}` and left the exact shape to this card's judgment. This
addendum's route (`POST /v1/runtime/sites/:siteId/cart-checkout`) accepts
only `{items: {productId, quantity}[]}` — `successUrl`/`cancelUrl` are
derived from the request's own `Referer`/`Origin` header, appended with
`pf_cart=success|cancel`, **exactly** the mechanism
`/v1/runtime/payment-blocks/:blockId/checkout` and
`/v1/runtime/subscription-blocks/:blockId/checkout` already use (see
app.ts's own `returnUrl` helper on each route) — not because those two
routes happen to do it that way, but because accepting a visitor-supplied
redirect target is a real open-redirect surface (a crafted request could set
`successUrl` to an attacker's own domain, and Stripe will happily redirect a
completed Checkout session there) that this repo's own existing runtime
routes already avoid paying. `shippingCountries` is dropped for the same
reason point 4 already gives: the allowed-country list is a
money/fraud-adjacent knob (it constrains what Stripe will even let the
visitor select, which composes with the flat-rate amount to determine what
gets charged) and stays server-configured, never client-supplied.

### 6. Completion metadata for KAN-1246

`createCartCheckoutSession` sets, on every cart Checkout Session:

- `client_reference_id` = the `cart_checkout_records` row's own id
  (`cartCheckoutRecordId`) — same field, same purpose, as
  `paymentRecordId`/`subscriptionRecordId` on the existing two adapters.
- `metadata[checkoutType]` = `"cart"` — the one thing neither existing
  adapter needs, because KAN-1246's webhook consumer will see
  `checkout.session.completed` for all three kinds (one-off, subscription,
  cart) on the same Connect webhook endpoint and has to know which table's
  row `client_reference_id` names before it can resolve tenant context
  (mirrors ADR-0016 part 2's own `extractSubscriptionEventContext` problem:
  resolve identity before ever touching a tenant-isolated table).
- `metadata[siteId]` = `siteId` — same mechanism every existing adapter here
  already uses to resolve tenant context with no signed-in principal and no
  siteId in the webhook's own URL.

**Deliberately not sent**: an itemized `metadata[items]` JSON blob. Stripe
caps a metadata value at 500 characters — comfortably enough for a
one-or-two-item cart, and quietly truncated or rejected for a large one,
which is exactly the kind of "works in every test, breaks for one real
customer" bug this repo's own UNVERIFIED-adapter discipline tries to design
out rather than discover later. The full itemization already lives,
un-truncated, in `cart_checkout_records.items` — written by this card,
before the Stripe call — so KAN-1246's webhook consumer reads it by looking
up `cart_checkout_records` via `cartCheckoutRecordId` (from
`client_reference_id`) instead of ever needing Stripe's own metadata to
carry it. This is a stricter version of the same shape ADR-0016 part 2
already uses (Stripe metadata carries an *id*; the authoritative payload
lives in this repo's own Postgres row), not a new pattern.

## Note for card 3 (KAN-1246)

Everything above is creation-only, the same "part 1, not part 2" split
ADR-0016 already used for subscriptions: `cart_checkout_records.status`
exists and defaults to `'pending'`, but nothing in this card transitions it,
decrements `products.stock_count`, or creates an order. KAN-1246's own
webhook consumer will need (at minimum): a `checkoutType` branch in whatever
consumes `checkout.session.completed` on the Connect webhook endpoint (this
card's `metadata[checkoutType] = "cart"` is that branch's own discriminant),
a `cart_checkout_records` lookup by `client_reference_id`/
`cartCheckoutRecordId` (mirrors `getSubscriptionRecordById`'s own shape —
no `getCartCheckoutRecordByStripeSessionId` exists yet; add whichever lookup
the webhook payload actually makes easiest, the same "don't pre-build a read
shape before the caller that needs it exists" discipline
`subscription-records.ts`'s own history already followed), and a decision
about whether `stock_count` decrements atomically against the same
`fromStatuses`-guarded-transition idempotency discipline
`updateSubscriptionLifecycle`/`updatePaymentRecordStatus` already use
elsewhere in this codebase.

## Note for card 4 (KAN-1247): a known, temporary self-host gap

`@prefab/publish`'s `SITE_PAGE_ASTRO` is shared verbatim between a live
publish and `ejectSite` (`packages/publish/src/eject.ts` writes it out
unchanged) — so this card's `ProductDetail`/`CartDrawer` hydration ships to
an ejected/self-hosted site exactly as it ships to a platform-hosted one.
Unlike Payment/Subscription (`apps/self-host/src/app.ts` already implements
`/v1/runtime/payment-blocks/:blockId/checkout` and
`/v1/runtime/subscription-blocks/:blockId/checkout` today), this card does
**not** add a self-host counterpart for
`/v1/runtime/sites/:siteId/cart-checkout` — that is explicitly card 4's own
scope ("Self-host runtime changes of any kind"), not this one's to guess at.
Concretely: add-to-cart itself works identically everywhere (it's 100%
client-side, no server involved), but CartDrawer's own "Checkout" button
will hit a 404 on a self-hosted/ejected site until KAN-1247 adds that
route (and, presumably, a SQLite-backed `CartProductStore`/
`CartCheckoutRecordStore`/`TenantCartCheckoutProvider` triple mirroring
whatever apps/self-host already did for the one-off/subscription paths).
Flagged here rather than left to be discovered, the same "designed in
from the start, not bolted on when someone almost got it wrong" discipline
this ADR's part 1 already used for `fulfillmentType`.
