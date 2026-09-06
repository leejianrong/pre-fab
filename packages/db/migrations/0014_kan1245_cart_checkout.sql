-- KAN-1245 / ADR-0018 (cart addendum, part 2): cart and multi-item
-- checkout, bring-your-own Stripe. Two changes, both scoped exactly to what
-- that addendum's "Note for cards 2-4" left this card to resolve.
--
-- 1. `products_public_read`: 0013_kan1244_products.sql deliberately shipped
-- with no public-read policy, naming this card's own runtime checkout
-- endpoint as the future reader that would need one. Scoped to
-- `status = 'published'` — NOT the unscoped `USING (true)` shape
-- `payment_blocks_public_read`/`subscription_blocks_public_read` use —
-- because, unlike a payment/subscription block's immutable publish-time
-- snapshot, a `products` row can sit in `'draft'` indefinitely and its id is
-- not secret. An unscoped policy would let a visitor holding a draft
-- product's id (a leaked preview link, a scraped API response) add it to a
-- cart and complete a real charge for a product the owner never intended
-- to sell — the same failure `isProductVisible`/`isPostVisible` already
-- exist to prevent everywhere else a product is shown to a visitor. See the
-- ADR addendum's point 1 for the full reasoning (including why this reads
-- the LIVE table rather than adding a publish-time snapshot: `stockCount`
-- must be re-validated against the CURRENT row, which a snapshot would
-- defeat the entire purpose of).
--
-- This is a second, OR'd permissive policy alongside the existing
-- `products_tenant_isolation` (unchanged) — an owner's own authenticated
-- read still sees every status; a context-free runtime read sees published
-- rows only.
CREATE POLICY products_public_read ON products
  FOR SELECT USING (status = 'published');

-- 2. `cart_checkout_records`: a sibling to `payment_records`/
-- `subscription_records`, not a branch on either — a cart checkout has no
-- `block_id` at all (payment_blocks/subscription_blocks' FK doesn't apply;
-- a cart spans however many products a visitor chose, off any one page).
-- Mirrors `payment_records`'s shape and RLS posture exactly: platform-only,
-- tenant-isolated, no public read (visitor-PII-adjacent once buyer_email is
-- known, R20). `items` is written once, before the Stripe API call, by
-- @prefab/runtime's createCartCheckout — every field in it is already
-- server-resolved against the current `products` row at that point, never
-- the visitor's own cart's denormalized display copy.
--
-- `status` defaults to 'pending' and this card's own code never transitions
-- it — mirrors 0012_kan1154_subscriptions.sql's own precedent exactly: the
-- column exists so KAN-1246's webhook consumer has somewhere to write
-- ('completed'/'failed') without a second migration, but there is no
-- `updateCartCheckoutRecordStatus` function yet, because there is no
-- webhook consumer yet to call it. See the ADR addendum's point 2/6 and its
-- "Note for card 3" for what KAN-1246 still owes this table.
CREATE TABLE cart_checkout_records (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  stripe_session_id text NOT NULL,
  -- [{productId, quantity, unitAmount, currency, title, fulfillmentType}, ...]
  -- — the authoritative, server-resolved itemization (see this migration's
  -- own header comment for why this lives here rather than in Stripe's own
  -- metadata, which the ADR addendum's point 6 covers).
  items jsonb NOT NULL,
  currency text NOT NULL,
  -- Cents — sum of every line's unitAmount * quantity, EXCLUDING shipping
  -- (Stripe computes/collects the shipping charge itself; this column is
  -- for this repo's own display/reporting, mirroring payment_records.amount
  -- being the one thing a tampered request must never override).
  amount_subtotal integer NOT NULL CHECK (amount_subtotal >= 0),
  requires_shipping boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  buyer_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cart_checkout_records_site_id_created_at_idx ON cart_checkout_records (site_id, created_at DESC, id);
-- checkout.session.completed (a future card's webhook) looks a session up
-- by id alone, with no siteId in hand yet — same reasoning as
-- payment_records_stripe_session_id_idx.
CREATE UNIQUE INDEX cart_checkout_records_stripe_session_id_idx ON cart_checkout_records (stripe_session_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON cart_checkout_records TO prefab_app;

ALTER TABLE cart_checkout_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_checkout_records FORCE ROW LEVEL SECURITY;

-- No public policy — see this migration's own header comment for why.
CREATE POLICY cart_checkout_records_tenant_isolation ON cart_checkout_records
  USING (site_id = current_setting('app.site_id', true));
