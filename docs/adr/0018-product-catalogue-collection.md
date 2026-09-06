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

## Addendum (part 3, KAN-1246): orders, inventory decrement, fulfillment

Part 2's own "Note for card 3" left four things unresolved: whether this
card creates a new `orders` table, whether stock decrements atomically
against the same `fromStatuses` idempotency discipline used elsewhere, what
happens when that decrement fails, and (from the card's own brief, not part
2) how a digital/service product's post-purchase message actually reaches
the visitor. Four decisions, in that order.

### 1. `cart_checkout_records` IS the order header — no new `orders` table

The card's own text says "new `orders`/`order_items` tables," as if from
scratch. It isn't: `cart_checkout_records` (0014_kan1245_cart_checkout.sql)
already carries every field an order header needs — `site_id`, `currency`,
`amount_subtotal`, `status` (`'pending'` → `'completed'`/`'failed'`,
deliberately left for this card to transition, per that migration's own
header comment), `buyer_email`, timestamps. Creating a parallel `orders`
table with the identical shape would mean two rows describing the same
event, kept in sync by hand forever, or — more likely — a query that has to
join across them to answer "list this site's orders." The two tables
would diverge only in `id` and nothing else, which is exactly the "one
thing, described twice" shape ADR-0016's own question 3 already rejected
for `subscription_records` vs. a `payment_records.type` branch.

**Decision: no `orders` table.** `markCartCheckoutRecordCompleted`
(`packages/db/src/repositories/cart-checkout-records.ts`) is the function
this card adds to finally drive `cart_checkout_records.status` out of
`'pending'` — the transition part 2's own migration comment named as this
card's job — and a `cart_checkout_records` row **is** an order from the
moment that transition lands. `listCartCheckoutRecordsForSite` (new, mirrors
`listPaymentRecordsForSite`/`listSubscriptionRecordsForSite`) is the
owner-facing `order.list` read.

What genuinely doesn't fit in `cart_checkout_records` is per-line
fulfillment state: `items` is a `jsonb` blob written once, before the
Stripe call, by KAN-1245's `createCartCheckout` — every field in it
(`unitAmount`, `currency`, `title`, `fulfillmentType`) is already
server-resolved and correct at that point, but it has no place to record
"and *this* line has since shipped, with tracking number X" without
rewriting the whole blob on every fulfillment action and losing any
per-line optimistic-concurrency story. **`order_items`** (new,
0015_kan1246_orders.sql) is that table — one row per cart line, FK'd to
`cart_checkout_records.id`, holding exactly the fulfillment-relevant state
the header's own `items` blob can't cleanly mutate: `product_id`,
`quantity`, `unit_amount`, `currency`, `title` (snapshotted, same reasoning
as the header's own `items.title`), `fulfillment_type`, `status`
(`unfulfilled`/`shipped`/`delivered`), `tracking_number` (nullable),
`oversold` (see point 3), timestamps. This is a genuinely new table with a
genuinely new purpose, not a second header.

### 2. Cart-mode discrimination: `metadata.checkoutType`, inserted between the subscription branch and the existing one-off branch

`/v1/webhooks/stripe-connect`'s `checkout.session.completed` handler
already branches one-off-vs-subscription on Stripe's own `object.mode`
field (KAN-1154 part 2) — but a cart checkout also uses `mode: "payment"`
(the same mode a one-off Payment block session uses), so `mode` alone
cannot tell a cart-mode session from a one-off one. KAN-1245's
`createCartCheckoutSession` already sets `metadata.checkoutType = "cart"`
for exactly this reason (that addendum's point 6, written before this card
existed to consume it). This card's new branch checks
`object.metadata?.checkoutType === "cart"`, inserted **after** the
subscription branch returns early and **before** the existing one-off
branch's own code — so a cart checkout is caught before it can ever fall
through into `updatePaymentRecordStatus` (which would silently no-op for a
cart session, since no `payment_records` row exists for it, but "silently
no-op" is exactly the failure mode worth avoiding by ordering this
correctly rather than relying on it).

Both branches then resolve the row to update by `object.id` — Stripe's own
Checkout Session id — not `metadata.cartCheckoutRecordId` (KAN-1245 already
sets that metadata field too, but for a different purpose: threading the
record's own id to the visitor's browser via `client_reference_id`, for
this card's post-purchase receipt endpoint, point 5 below — never as a
webhook lookup key). `0014_kan1245_cart_checkout.sql`'s own header comment
names the `stripe_session_id` index exactly for this: "a session up by id
alone, with no siteId in hand yet — same reasoning as
`payment_records_stripe_session_id_idx`." `markCartCheckoutRecordCompleted`
(point 1 above) is keyed by `stripe_session_id` for exactly that
already-decided reason, mirroring `updatePaymentRecordStatus`'s identical
lookup one branch below it — not a new convention, the existing one applied
to a third table.

### 3. Oversell handling: never block the order, flag the line instead

The card's own open question: what happens when the atomic stock decrement
finds insufficient stock — two visitors raced for the last unit(s), and by
the time this webhook runs (Stripe's own delivery is not synchronous with
the Checkout Session completing), fewer than `quantity` remain?

The Stripe payment has **already succeeded** by the time this function
runs — the customer's card was charged before this webhook ever fires.
Failing the order/order_item creation here would mean a customer paid for
nothing with no record of it anywhere in this repo, the one outcome this
project's own R7.4 posture ("never a blank page, never a silently dropped
failure — surface it") exists to rule out. Silently ignoring the shortfall
(decrementing below zero, or leaving stock unchanged) would corrupt the
inventory count for every subsequent visitor's own checkout-time
revalidation (`createCartCheckout` already re-checks `stockCount` against
the current row on every call).

**Decision: `decrementProductStock` (`packages/db/src/repositories/
products.ts`) tries the strict conditional UPDATE first
(`stock_count >= quantity`, the DB-level guard the card asks for, not an
app-level read-then-write) — the common case, no race. When that matches
zero rows, a second UPDATE floors the count at zero
(`GREATEST(stock_count - quantity, 0)`) rather than leaving the order
uncreated or the count negative, and reports `oversold: true` back to the
caller.** `cart-order-webhook.ts` records that on the order_item's own
`oversold` boolean rather than blocking anything. There is no owner
mutation to clear it in this card — the card's own brief describes the
resolution as "refund via their own Stripe dashboard, contact the
customer," both of which happen outside this system; `oversold` is
surfaced in the owner's order-detail view (`OrdersPanel.tsx`) as a visible
flag so the owner knows to act, not auto-resolved. Both the strict UPDATE
and its floor fallback run inside the **same** transaction as the
`cart_checkout_records.status` transition and this line's own
`order_items` insert (see point 4) — a decrement can never happen without
its order_item existing to record whether it was oversold.

### 4. Idempotency and atomicity: one transaction, two guards, the same shape ADR-0016 already established

Two layers, identical in kind to `subscription-webhook.ts`'s own (see that
file's module comment for the full precedent this mirrors):

1. **Exact redelivery**: `recordStripeWebhookEvent` against the same
   *global* `stripe_webhook_events` table subscriptions and payments
   already share — Stripe event ids are globally unique regardless of
   which integration receives them, so this needed no new table.
2. **Out-of-order / duplicate-but-different-event-id delivery**:
   `markCartCheckoutRecordCompleted`'s own `AND status = 'pending'` guard —
   the `fromStatuses`-style precondition the card asked for, generalized
   from `updateSubscriptionLifecycle`'s caller-supplied set down to the one
   transition this table actually has (`'pending'` → `'completed'`, `
   'failed'` being unreachable from this card — see the note below).

New to this card: order_items creation and the stock decrement happen
**inside the same `withTenantContext` call** as the status transition
itself — one Postgres transaction, one `client`, one COMMIT or none.
`withTenantContext` already wraps its callback in `BEGIN`/`COMMIT`/
`ROLLBACK` (`packages/db/src/tenant-context.ts`); `cart-order-webhook.ts`'s
`applyCartCheckoutCompleted` runs `markCartCheckoutRecordCompleted`, every
line's `decrementProductStock`, and every line's `createOrderItem` inside
one such call. This is what makes the atomicity claim true end to end: a
redelivered webhook that raced with the first delivery's own transaction
either sees the row already `'completed'` (guard 2 above fires, whole
callback returns `null`, nothing further runs) or doesn't start until the
first delivery has fully committed (line items and stock decrements
included) — there is no window where the header is `'completed'` with some
or none of its order_items created.

`cart_checkout_records.status`'s `'failed'` value (part 2's own migration)
is not driven by anything in this card, the same "value exists for a future
transition, no code populates it yet" shape `subscription_records`'
`current_period_end` etc. carried before KAN-1154 part 2 populated them.
Stripe does not deliver a "this cart checkout failed" event the way it
delivers `invoice.payment_failed` for a subscription — an abandoned cart
Checkout session simply never completes, leaving the row `'pending'`
forever. Nothing in this card's scope needed to reconcile that (no
"expire stale pending carts" job was asked for); flagged here rather than
silently left unmentioned.

### 5. Digital/service post-purchase message: a receipt endpoint keyed by the cart-checkout record id, read with the SAME no-principal tenant-context trust model the create route already uses

`CartDrawer`'s success-redirect handling only ever cleared the cart and
showed a hardcoded "Thank you for your order!" — no per-product
`successMessage` reached the visitor at all, for either fulfillment type.
Closing this gap needed a way for the visitor's browser, after Stripe
redirects back, to ask "what should I show for the items I just bought?"
with no signed-in principal (a visitor, not an owner) and no session of any
kind.

The runtime cart-checkout route's own `returnUrl` helper already appends
`pf_cart=success|cancel` to the Referer/Origin-derived redirect target
(KAN-1245's own point 5: never a visitor-supplied redirect, to avoid an
open-redirect surface). This card additionally threads the Checkout
session's own `cartCheckoutRecordId` (the same id already generated before
the Stripe call, and already carried in `client_reference_id`/
`metadata.cartCheckoutRecordId`) through as `pf_cart_id` on the success
redirect only — it is not new information reaching the visitor's browser
that Stripe wasn't already going to hand back some identifier for, and it
never appears anywhere but this one same-origin redirect URL.

**Decision: `GET /v1/runtime/sites/:siteId/cart-checkout/:cartCheckoutRecordId/receipt`**,
no principal, reading `cart_checkout_records` via
`withTenantContext(pool, { siteId })` with `siteId` taken directly from the
URL — **not** a new public-read RLS policy on `cart_checkout_records`.
This is the identical trust model the existing cart-checkout *creation*
route already uses today (`createPostgresCartCheckoutRecordStore`'s own
`create` calls `withTenantContext(pool, { siteId: input.siteId }, ...)`
with no principal either): `tenant_isolation`'s RLS predicate is
`site_id = current_setting('app.site_id')`, and since the query's own
`WHERE id = $cartCheckoutRecordId AND site_id = $siteId` supplies both
sides of that comparison, an attacker who doesn't already know a real
`(siteId, cartCheckoutRecordId)` pair learns nothing — `siteId` is public
(every runtime route on this repo already takes it unauthenticated from the
URL) and a ULID has no practically guessable structure. This is a strictly
narrower exposure than adding a scoped public-read *policy* would have
been: a policy is permissive for **any** future context-free query against
this table, forever, whereas this route's own SQL selects only what it
needs and nothing else reads this table with no tenant context.

The route itself returns only `{ items: [{ productId, title,
fulfillmentType, successMessage }] }` for a `'completed'` record (anything
else — not found, still `'pending'`, `'failed'` — is a 404: there is
nothing to show yet, or ever). It never returns `buyer_email`,
`amount_subtotal`, or any other field from the row — the response is built
by re-reading each item's *current* `products` row via the already-existing
`getProductPublic` (KAN-1245, scoped to `status = 'published'`) for its
live `successMessage`, falling back to a generic thank-you if the product
was since unpublished or deleted, rather than erroring the whole response
for one missing line. `CartDrawer`'s existing success-detection effect
calls this once, on mount, when `pf_cart=success` and `pf_cart_id` are both
present, and renders each item's own message instead of (not merely
alongside) the old hardcoded string — physical lines get their own
`successMessage` too (defaulted to "Thank you for your purchase.", part 1's
own default), not just digital/service ones, since the field was never
type-restricted to one fulfillment type in the first place.

### 6. `order.markShipped` is the only owner-driven status transition this card wires up — `delivered` for a physical line has no mutation yet

The card's own "your two deliverables" section names exactly three
mutations needing full three-surface parity: `order.list`, `order.get`,
`order.markShipped`. Read literally alongside the fulfillment-lifecycle
bullet ("owner can mark `shipped`... then `delivered`"), a naive reading
would add a fourth, `order.markDelivered`. This addendum does not: for a
small storefront, "delivered" for a physical line is usually confirmed by
a carrier or the customer, not something the owner clicks a button for
with no tracking-integration to base it on (tracking numbers here are
free-text, not looked up against any carrier API — deferred, same as
tax/carrier-computed shipping). Adding a mutation for a transition nothing
in this card's own brief actually asked to drive would be scope creep in
the other direction from the card's own "thin slice" instruction.

`order_items.status` still carries all three values (`unfulfilled`/
`shipped`/`delivered`) — a digital/service line is written `'delivered'`
directly at order-creation time (the card's own explicit requirement), and
`'delivered'` remains available for a physical line for a future card to
drive (a carrier webhook, a customer-facing "confirm receipt" link, or a
manual mutation) the same way `subscription_records`' own
`current_period_end`/`cancel_at_period_end` existed on that table before
KAN-1154 part 2 ever populated them. Flagged here rather than silently
built around, the same discipline this ADR's own part 2 used to flag the
pre-existing "no BookingsPanel status-change action" gap without spending
this card's scope fixing it.

### 7. Live stock display wired for `productDetail`, not `productGrid`

The card's own brief asks for a "small runtime endpoint for live stock
display... so `productGrid`/`productDetail` can show 'sold out'." This
card adds the endpoint (`GET /v1/runtime/sites/:siteId/products/:productId/
stock`) and wires it into `productDetail` only.

`page-template.ts`'s own module comment is explicit about why `productGrid`
was deliberately left off the `client:load` hydration list part 1 already
built: "it makes no runtime call and has no client-side state of its own
(a visitor clicks through to a product's own `productDetail` page to add it
to a cart)." Hydrating a paginated grid of up to a dozen cards to fetch
per-card live stock is a real behavior change to that documented design,
not a narrow addition — every card would need its own fetch, page weight
grows for a block that ships 0 KB today by design (ADR-0007), and the
actual "about to buy" decision point this endpoint matters most for is
`productDetail`, which a shopper reaches before ever completing an
add-to-cart. `productGrid` keeps showing its build-time "Out of stock"
snapshot (part 1's own read-only display), refreshed on the next publish —
unchanged from today. Flagged as a deliberate, narrower-than-literally-asked
scope call rather than left to be discovered; revisit if a future card
finds shoppers actually hitting sold-out adds from the grid itself.

## Addendum (part 4, KAN-1247): self-host, export/eject verification, containment/parity verification

The last card of EPIC-178. Three claims in this card's own brief were
verified against the current code before writing anything (all three
confirmed true, one materially corrected — see below), and the remainder is
apps/self-host's own reimplementation of every KAN-1245/1246 runtime
endpoint against SQLite, the same "narrow port, injected, duplicated rather
than imported" discipline every self-host adapter in this repo already
follows (ADR-0010).

### 0. Verifying the brief's own claims

**Export/eject already thread products through, byte-identical.** Confirmed
by reading `export-bundle.ts`/`eject.ts`'s own `allProducts` helpers and
`packages/publish/src/eject.ts`'s `products: sortProductsByTitle(...)` —
exactly as the brief described. Added: a product to the existing R8
byte-identity round trip (`packages/commands/test/commands.integration.test.ts`),
since one didn't already cover a site with catalogue content.

**`orders`/`cart_checkout_records` never appear in an export, by
construction.** Confirmed: neither table's repository functions are
imported anywhere in `export-bundle.ts`, `eject.ts`, `pull.ts`, or
`push.ts`. Added a regression test creating a real completed order (product
→ Stripe Checkout → dev-advance → `order_items` row) against a live test
database, then asserting `exportSite`/`eject`'s own output trees contain
neither an order-shaped file nor an order-shaped string anywhere in their
output — the "by construction" claim proven against a real order, not just
against the absence of an import.

**Containment and parity already pass, unchanged.** Ran both before writing
any code: `pnpm run ci:containment` (five green checks, including
`checkRuntimeContainment(files, ["packages/runtime", "apps/self-host"])`,
which already watches `apps/self-host` and finds nothing to flag) and `pnpm
run ci:parity` (33/33 API mutations have CLI/MCP parity). **Correction to
the brief's own framing**: the brief describes an "R20's CI-enforced
no-visitor-PII check" as something to "extend... to cover order data if it
doesn't already." No such check exists — `tools/checks/src/cli/` has
`containment.ts`, `parity.ts`, `fidelity.ts`, and `budgets.ts`, and none of
them scan for PII or enforce R20 at all; R20 is discipline plus code review
today, not a CI gate. This card does not add one (a general-purpose
"no-PII-shaped-column-name-in-an-export" static scanner is a real, separate
piece of infrastructure nothing in this card's own scope asked for) — it
adds the regression test described above instead, which is what the card's
own corrected instructions actually ask for ("add a regression test... not
[build] a new CI tool").

### 1. How self-host sources its own product price/stock mirror: a manifest for content, a preserved column for locally-mutated state

Every existing self-host "manifest" (`prefab-forms.json`,
`prefab-payment-blocks.json`, `prefab-subscription-blocks.json`,
`prefab-booking-widgets.json`, `prefab-event-signups.json`) is written by
`build-worker.ts` from page-scraped block props and fully overwritten on
every reseed (`ON CONFLICT ... DO UPDATE SET` on every column) — correct
for all of them, because none of those rows have any locally-mutated state
of their own to protect (a payment block's `amount` never changes except by
republishing the page it's on). `availability_rules` is the one existing
exception: seeded once (`ON CONFLICT (site_id) DO NOTHING`) and never
touched by a later reseed, because an operator's local edit to it must
survive a re-export.

`products` is neither shape cleanly. `title`/`price`/`currency`/
`fulfillmentType`/`successMessage` are owner-authored catalogue content —
exactly like a payment block's `amount`, they should track the next
export/restart. `stockCount`, once a self-hosted instance is actually
taking orders, is **locally-mutated state** — every completed physical-line
order decrements it (see part 3 below) — and must survive a reseed/restart
the same way `availability_rules` survives one, or a container restart
after a real sale would silently un-sell the very unit that was just
bought.

**Decision**: a new `prefab-products.json` manifest (written by
`build-worker.ts` via a new `packages/publish/src/product-manifest.ts`,
mirroring `payment-manifest.ts`'s shape but reading `input.products`
directly rather than scraping page blocks — products aren't page-scoped,
they're the site's own whole collection, already assembled by the caller)
carries **every** product on the site, draft included: `export-bundle`'s
own `allProducts` helper is unfiltered (mirrors `posts`), so a bundle
produced for self-hosting can genuinely contain draft products, unlike a
Payment/Subscription block (which only ever exists already-placed on an
already-published page). `products-seed.ts`'s own upsert
(`seedProductsFromBundle`) therefore mirrors `products_public_read`'s own
defense-in-depth reasoning (ADR-0018 cart addendum, point 1) rather than
trusting that a draft product's id can never reach a visitor: every column
is seeded, but `CartProductStore.getProduct()` (`cart-checkout-adapters.ts`)
only ever resolves a row with `status = 'published'` — the same "the
database is the last line of defense" posture the Postgres RLS policy
takes, reimplemented as a plain `WHERE` clause since SQLite has no RLS to
lean on (this file's own header comment already explains why: one site, no
tenant to isolate from).

The upsert itself is column-selective, a third shape distinct from both
existing precedents above:

```sql
INSERT INTO products (id, site_id, title, price, currency, fulfillment_type, stock_count, success_message, status)
VALUES (...)
ON CONFLICT (id) DO UPDATE SET
  site_id = excluded.site_id, title = excluded.title, price = excluded.price,
  currency = excluded.currency, fulfillment_type = excluded.fulfillment_type,
  success_message = excluded.success_message, status = excluded.status,
  stock_count = CASE WHEN fulfillment_type = excluded.fulfillment_type
                     THEN stock_count ELSE excluded.stock_count END
```

`stock_count` is deliberately absent from the plain column list and instead
computed: when this row's `fulfillment_type` is unchanged from what the
bundle now says, the *existing* (possibly locally-decremented) value wins;
only when `fulfillment_type` itself changed (an owner switched a product
from physical to digital or back — rare, but the schema allows it) does the
fresh manifest value win, because a stale stock count carried across a
fulfillment-type change would either violate the CHECK constraint below
(non-null required for physical, null required for digital/service) or
silently mean something the row no longer claims to be. A brand-new product
id (first time this instance has ever seen it) has no existing row to
preserve, so the plain `INSERT` branch seeds `stock_count` from the
manifest, same as everything else.

### 2. SQLite schema: `products`, `cart_checkout_records`, `order_items`

Three tables added to `apps/self-host/src/schema.sql`, each a direct
mirror of its Postgres migration (`0013_kan1244_products.sql`/
`0014_kan1245_cart_checkout.sql`/`0015_kan1246_orders.sql`) minus RLS,
`ulid`/`jsonb` column types, and `site_id`-as-tenant-scope — the same
translation every earlier self-host table in this file already documents.
`site_id` stays as a plain column on all three (present for parity with the
multi-tenant shape and because `order_items`/`cart_checkout_records` still
key some reads by it), never used for isolation — a self-hosted instance
serves exactly one site (this file's own header comment). `items` (jsonb on
Postgres) is stored as `TEXT` (JSON-serialized), parsed/stringified at the
call site exactly like `weekly_windows`/`date_overrides` on
`availability_rules` already are.

`products_stock_count_matches_fulfillment_type`'s CHECK constraint is
carried over unchanged — SQLite supports the same `CHECK (...)` syntax —
because it's exactly the kind of "the database is the last line of
defense" invariant this schema file's existing tables already keep even
though the RLS layer they'd normally sit inside doesn't exist here.

`cart_checkout_records`/`order_items` need no new webhook-dedup table:
`stripe_webhook_events` (added to this schema by KAN-1154 part 2) is
already the shared, event-type-agnostic table subscriptions and payments
use, and stays that way — a cart checkout's dedup guard is `recordStripeWebhookEvent`
(imported from `subscription-webhook.ts`, not duplicated a second time)
against the same table.

### 3. `cart-order-webhook.ts`: the SQLite mirror of apps/api's cart-order-webhook.ts

`apps/self-host/src/cart-order-webhook.ts` mirrors
`apps/api/src/lib/cart-order-webhook.ts` function-for-function
(`applyCartCheckoutCompleted`), against SQLite instead of
`withTenantContext`/Postgres:

- **Exact redelivery**: the same `recordStripeWebhookEvent` guard
  `subscription-webhook.ts` already exports and this file imports
  unchanged (one dedup table, every webhook consumer this instance has).
- **Out-of-order/duplicate delivery**: a `markCartCheckoutRecordCompleted`
  SQLite function with the identical `AND status = 'pending'` guard as the
  Postgres original — a redelivery matches no row, returns `null`, and the
  caller's `if (record)` guard skips order_items creation and the stock
  decrement a second time.
- **Oversell-safe decrement**: `decrementProductStock` mirrors
  `packages/db/src/repositories/products.ts`'s own two-UPDATE shape (a
  strict `stock_count >= quantity` conditional UPDATE first, a
  `MAX(stock_count - quantity, 0)` floor when that matches zero rows —
  SQLite's `MAX()` in place of Postgres' `GREATEST()`), reporting `oversold`
  back to the caller exactly the same way.
- **Atomicity**: no explicit `db.transaction()` wrapper. Every write in
  this function is a single synchronous `better-sqlite3` statement with no
  `await` between the status transition and the last `order_items` insert —
  the same reasoning `event-signup-adapters.ts`'s own module comment
  already gives for why this runtime needs no concurrency guard at all
  ("better-sqlite3 is synchronous, so a single JS process can never
  interleave two [operations] mid-transaction the way two concurrent
  Postgres connections can"): nothing else can run on Node's single thread
  between two synchronous statements with no intervening `await`, so there
  is no window for a second request to observe a half-applied order. A
  thrown error partway (a bug, not a race) would still leave a partial
  write with no automatic rollback — the one respect in which this is
  weaker than the Postgres original's real transaction — flagged here
  rather than silently assumed away; wrapping the core writes in
  `db.transaction()` would close that gap and is a one-line follow-up if it
  ever matters in practice.

### 4. `TenantStripeProvider.createCartCheckoutSession`: a third sibling method, same as apps/api's

`apps/self-host/src/lib/tenant-stripe.ts` gets the identical
`createCartCheckoutSession` method apps/api's `tenant-stripe-provider.ts`
already has (multi-line-item, `mode: "payment"`,
`metadata[checkoutType] = "cart"`, conditional
`shipping_address_collection`/`shipping_options` when `requiresShipping`),
implemented in both `FakeTenantStripeProvider` (a fake session id, driven
forward by a new dev-advance route) and `RealTenantStripeProvider`
(UNVERIFIED against a live account, same posture as every other real
adapter here). Shipping defaults come from the same
`CART_SHIPPING_FLAT_RATE_CENTS`/`CART_SHIPPING_LABEL`/
`CART_SHIPPING_ALLOWED_COUNTRIES` env vars apps/api reads, with the
identical built-in fallback (500 cents, "Standard shipping", `["US"]`) —
one operator-configured knob, not a per-site setting, same reasoning as the
cart addendum's own point 4.

### 5. Runtime routes and the webhook's third branch

Three new routes in `apps/self-host/src/app.ts`, identical in
request/response shape to apps/api's equivalents (same status codes, same
error bodies, same CORS headers) since a published page's client-side code
must work unmodified against either host:

- `POST /v1/runtime/sites/:siteId/cart-checkout`
- `GET /v1/runtime/sites/:siteId/products/:productId/stock`
- `GET /v1/runtime/sites/:siteId/cart-checkout/:cartCheckoutRecordId/receipt`

None of the three are registered anywhere CLI/MCP-parity-checked — same
reasoning `mutations.ts`'s own comments give for why `booking.create` and
the payment/subscription checkout routes are absent from `API_MUTATIONS`:
no signed-in principal, so there is no owner-facing mutation here for a
CLI/MCP surface to mirror. This card's self-host routes are not part of
`apps/api` at all, so they were never candidates for that registry in the
first place; noted for completeness, not because anything needed to
change.

The self-host `/v1/webhooks/stripe-connect` route gets a third branch,
inserted in the same position apps/api's own route uses (after the
subscription branch returns early, before the pre-existing one-off-payment
code) — `object.metadata?.checkoutType === "cart"` dispatches to
`applyCartCheckoutCompleted`. Confirmed before touching this file: the
one-off payment webhook path in self-host was still exactly what KAN-1154
part 2's own comment says it is ("even the one-off payment path... only
ever had the dev-advance route... that gap is pre-existing and out of this
card's scope") — untouched by this addition, same as the brief instructed.
A `/v1/dev/stripe-connect/:siteId/cart/advance`-shaped route (no `:siteId`
param, since self-host is one site) drives the same
`applyCartCheckoutCompleted` for e2e testability with no live Stripe
account, mirroring the existing `/v1/dev/stripe-connect/subscriptions/advance`
pattern.

### 6. A known, pre-existing gap this card does not fix: self-host has no order-management surface at all

`order.markShipped` (and `order.list`/`order.get`) are owner-facing
mutations/reads with a full API/CLI/MCP surface on the hosted platform.
Self-host has no owner-authenticated surface of any kind — no accounts, no
sessions, no admin UI, no CLI wired to a running instance — so there is
nothing for these to attach to there, and this card does not invent one.
This is the exact same shape as the pre-existing gap ADR-0018's own part 2
addendum already flagged for `BookingsPanel`'s status-change actions in
self-host, and the same one apps/self-host's own README already documents
for form/booking data ("Bookings themselves... are never portable at all
... they only ever exist in `$DATA_DIR/prefab.db`"): an operator who needs
to mark a self-hosted order shipped, or read a submission, does so directly
against `$DATA_DIR/prefab.db` with `sqlite3` — the same escape hatch this
README already documents for `form_settings`/`availability_rules`. Worth
naming as a real, if narrow, product gap: a self-hosted storefront owner
gets a fully working checkout and no dashboard to fulfill orders from at
all, not even a read-only one — PLAN.md's own affordances table is explicit
that self-host is "serves the bundle, implements the runtime API," not the
editor, so this is consistent with the product's own stated shape rather
than an oversight, but it is the sharpest edge of that shape milestone 3
has produced so far (a booking or form submission an operator merely reads
locally is a smaller ask than fulfilling and shipping a physical order by
hand-editing SQLite rows). Flagged for a future card, not fixed here — the
same "note only, don't fix" instruction this card's own brief gives.
