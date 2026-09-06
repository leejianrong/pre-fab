-- KAN-1244 / ADR-0018: the product catalogue collection, milestone 3's first
-- card. Mirrors 0005_slice5.sql's `posts` table shape (own collection, same
-- optimistic-concurrency `version` every mutation gets) rather than growing
-- `posts` with e-commerce fields — see ADR-0018 question 1 for why a shared
-- shape was rejected.
--
-- `fulfillment_type` is designed in from this card even though shipping/
-- inventory-decrement logic is a later card's job (ADR-0018 question 2): a
-- physical product's `stock_count` is real, decrementable inventory; a
-- digital/service product has none, and is auto-delivered on payment. The
-- CHECK below enforces the pairing at the database's own last line of
-- defense (application-level enforcement lives in
-- @prefab/schema's validateProductDocument) — `stock_count` must be NULL
-- for a digital/service product and non-negative for a physical one.
--
-- Single-SKU only for milestone 3 (ADR-0018 question 3): one `price`, one
-- `stock_count` column, no variants table.
--
-- Unlike `payment_blocks`/`subscription_blocks`, there is no public-read
-- policy here: nothing in this card resolves a product with no tenant
-- context (productGrid/productDetail are rendered at *build* time, inside
-- the same withTenantContext every page/post read already uses — see
-- packages/publish/src/page-template.ts). A future card's runtime checkout
-- endpoint may need one; that is that card's migration to write, not this
-- one's to guess at.

CREATE TABLE products (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  version integer NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  -- Plain URL strings (asset upload's own content-addressed URLs), same
  -- "no separate asset-reference concept" convention the image/gallery
  -- block schemas already use — see ADR-0018's own "Rejected" section.
  images jsonb NOT NULL DEFAULT '[]',
  -- Cents, always a positive integer — the one field a tampered visitor
  -- checkout request (a future card) must never be able to override, same
  -- reasoning as payment_blocks.amount/subscription_blocks.price.
  price integer NOT NULL CHECK (price > 0),
  currency text NOT NULL DEFAULT 'usd',
  fulfillment_type text NOT NULL DEFAULT 'physical' CHECK (fulfillment_type IN ('physical', 'digital_or_service')),
  -- NULL only for a digital/service product (nothing to run out of);
  -- required and non-negative for a physical one. See this migration's own
  -- header comment.
  stock_count integer CHECK (stock_count IS NULL OR stock_count >= 0),
  CONSTRAINT products_stock_count_matches_fulfillment_type CHECK (
    (fulfillment_type = 'physical' AND stock_count IS NOT NULL)
    OR (fulfillment_type = 'digital_or_service' AND stock_count IS NULL)
  ),
  -- Shown after checkout (a future card) — the product's own post-purchase
  -- message, modelled on payment_blocks.success_message/
  -- subscription_blocks.success_message.
  success_message text NOT NULL DEFAULT 'Thank you for your purchase.',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug)
);

CREATE INDEX products_site_id_status_idx ON products (site_id, status, id);

GRANT SELECT, INSERT, UPDATE, DELETE ON products TO prefab_app;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

-- Same tenant-context mechanism as every other table (ADR-0008) — the
-- publish pipeline reads products inside withTenantContext(pool, { siteId })
-- exactly like it reads posts, so there is no need for a public,
-- context-free read policy: a published bundle serves static files, never a
-- live query.
CREATE POLICY products_tenant_isolation ON products
  USING (site_id = current_setting('app.site_id', true));
