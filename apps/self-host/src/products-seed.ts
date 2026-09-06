import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SelfHostDb } from "./db.js";

interface PublishSafeProductManifest {
  id: string;
  siteId: string;
  title: string;
  price: number;
  currency: string;
  fulfillmentType: "physical" | "digital_or_service";
  stockCount: number | null;
  successMessage: string;
  status: "draft" | "published";
}

/**
 * KAN-1247 / ADR-0018 (part 4 addendum): seeds this instance's own SQLite
 * `products` table from the exported bundle's `prefab-products.json` —
 * every product, draft included (see product-manifest.ts's own comment for
 * why). Idempotent across restarts and re-exports, like every other
 * `seed*FromBundle` function here, but with one deliberate difference from
 * `seedPaymentBlocksFromBundle`'s own "overwrite every column" upsert:
 * `stock_count` is NOT in the plain `SET` list.
 *
 * `title`/`price`/`currency`/`fulfillmentType`/`successMessage`/`status`
 * are owner-authored catalogue content — like a payment block's `amount`,
 * they should always track the next export/restart, so every reseed
 * overwrites them unconditionally. `stockCount`, once this instance is
 * actually taking orders, is LOCALLY-MUTATED state: a real completed
 * physical-line order decrements it (cart-order-webhook.ts) — overwriting
 * it back to the bundle's own baked-in snapshot on every restart would
 * silently un-sell whatever had just sold, the same failure
 * `seedAvailabilityFromBundle`'s own `ON CONFLICT ... DO NOTHING` exists to
 * prevent for a locally-edited availability rule. Unlike that table, this
 * one still needs its OTHER columns to refresh on reseed, so this is a
 * column-selective upsert rather than a whole-row "seed once, never touch
 * again": `stock_count` is preserved only when `fulfillment_type` is
 * unchanged (the common case). If `fulfillment_type` itself changed since
 * this row was last seeded (an owner switched a product between physical
 * and digital/service), the fresh manifest value wins instead — carrying a
 * stale stock count across a fulfillment-type change would either violate
 * this schema's own `products_stock_count_matches_fulfillment_type` CHECK
 * or silently mean something the row no longer claims to be. A brand-new
 * product id (first time this instance has ever seen it) has no existing
 * row to preserve, so the INSERT branch seeds `stock_count` from the
 * manifest like everything else.
 */
export async function seedProductsFromBundle(db: SelfHostDb, bundleDir: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(path.join(bundleDir, "prefab-products.json"), "utf8");
  } catch {
    return 0;
  }
  const products: PublishSafeProductManifest[] = JSON.parse(raw);

  const upsert = db.prepare(
    `INSERT INTO products (id, site_id, title, price, currency, fulfillment_type, stock_count, success_message, status)
     VALUES (@id, @siteId, @title, @price, @currency, @fulfillmentType, @stockCount, @successMessage, @status)
     ON CONFLICT (id) DO UPDATE SET
       site_id = excluded.site_id,
       title = excluded.title,
       price = excluded.price,
       currency = excluded.currency,
       fulfillment_type = excluded.fulfillment_type,
       success_message = excluded.success_message,
       status = excluded.status,
       stock_count = CASE WHEN products.fulfillment_type = excluded.fulfillment_type THEN products.stock_count ELSE excluded.stock_count END`,
  );
  for (const product of products) upsert.run(product);
  return products.length;
}
