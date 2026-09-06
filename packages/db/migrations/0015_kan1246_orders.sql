-- KAN-1246 / ADR-0018 (part 3 addendum): orders, inventory and fulfillment.
--
-- Per the addendum's own decision (see docs/adr/0018-product-catalogue-
-- collection.md's "Addendum (part 3, KAN-1246)"), this card does NOT create
-- a new `orders` table: `cart_checkout_records` (0014_kan1245_cart_checkout.
-- sql) already carries an order header's own shape (site_id, currency,
-- amount_subtotal, status, buyer_email) and this card's own
-- markCartCheckoutRecordCompleted (packages/db/src/repositories/
-- cart-checkout-records.ts) is what finally drives its `status` column out
-- of 'pending' — the very transition that migration's own header comment
-- named as "KAN-1246's job". A second, parallel `orders` table with the
-- identical shape would just be the same row twice.
--
-- What's genuinely new is per-line fulfillment state, which
-- `cart_checkout_records.items` (a jsonb blob, written once before the
-- Stripe call) cannot cleanly hold: a physical line's fulfillment status
-- moves (unfulfilled -> shipped -> delivered) independently, per line, after
-- the header is already immutable-in-spirit. `order_items` is that table —
-- one row per cart line, FK'd to the header it belongs to.
CREATE TABLE order_items (
  id ulid PRIMARY KEY,
  cart_checkout_record_id ulid NOT NULL REFERENCES cart_checkout_records (id) ON DELETE CASCADE,
  -- Denormalized from cart_checkout_records.site_id rather than joined for
  -- it on every read — every other platform-only table in this repo (
  -- payment_records, subscription_records, submissions, bookings) carries
  -- its own site_id for the exact same reason: RLS's tenant_isolation
  -- policy below needs it directly on THIS table, not two joins away.
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  -- No ON DELETE clause: there is no product.delete mutation in this repo
  -- today (products are archived via status, never removed), so this FK's
  -- default RESTRICT is never exercised. A future card that adds product
  -- deletion inherits the decision of what happens to an order that
  -- references it — not guessed at here.
  product_id ulid NOT NULL REFERENCES products (id),
  quantity integer NOT NULL CHECK (quantity > 0),
  -- Cents, snapshotted from cart_checkout_records.items at order-creation
  -- time — never re-read from the live `products` row, which may have
  -- changed price since. Same "money is resolved once, at the moment it was
  -- charged, never re-derived later" discipline every other _records table
  -- already follows.
  unit_amount integer NOT NULL CHECK (unit_amount >= 0),
  currency text NOT NULL,
  -- Snapshotted product title — survives a later product rename/deletion,
  -- same reasoning as cart_checkout_records.items' own `title` field.
  title text NOT NULL,
  fulfillment_type text NOT NULL CHECK (fulfillment_type IN ('physical', 'digital_or_service')),
  -- A physical line starts 'unfulfilled'; a digital/service line is written
  -- 'delivered' directly at creation (the card's own "auto-delivered on
  -- payment"). 'shipped' is the one owner-driven transition this card wires
  -- an actual mutation for (order.markShipped) — see that route's own
  -- comment in apps/api/src/app.ts for why 'delivered' has no owner-facing
  -- mutation for a physical line in this card.
  status text NOT NULL DEFAULT 'unfulfilled' CHECK (status IN ('unfulfilled', 'shipped', 'delivered')),
  -- Free-text, owner-supplied at ship time — no carrier integration/tracking
  -- API in this milestone (deferred, same as tax/carrier-computed shipping).
  tracking_number text,
  -- Set when this line's stock decrement (apps/api's cart-order-webhook.ts)
  -- found insufficient stock at order-creation time — the payment had
  -- ALREADY succeeded by then (Stripe collected the money before this
  -- webhook ever runs), so this never blocks order/order_item creation;
  -- it's a flag for the owner to resolve by hand (refund, contact the
  -- customer), not an error state. Always false for a digital/service line
  -- (nothing to oversell).
  oversold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_items_cart_checkout_record_id_idx ON order_items (cart_checkout_record_id);
-- The owner dashboard's own list/export reads — mirrors
-- payment_records_site_id_idx-shaped indexes across this repo.
CREATE INDEX order_items_site_id_created_at_idx ON order_items (site_id, created_at DESC, id);

GRANT SELECT, INSERT, UPDATE, DELETE ON order_items TO prefab_app;

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items FORCE ROW LEVEL SECURITY;

-- No public-read policy — same R20 posture as cart_checkout_records itself
-- (this table carries the same visitor-purchase-adjacent shape, one level
-- more granular). The one visitor-facing read this card adds (the
-- post-purchase success-message endpoint) reads `products`/
-- `cart_checkout_records` instead, keyed by a caller-supplied siteId the
-- same way the runtime cart-checkout route itself already is — see that
-- route's own comment in apps/api/src/app.ts.
CREATE POLICY order_items_tenant_isolation ON order_items
  USING (site_id = current_setting('app.site_id', true));
