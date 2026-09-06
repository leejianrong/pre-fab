import type { FulfillmentType, ProductDocument, ProductStatus } from "@prefab/schema";

/**
 * KAN-1247 / ADR-0018 (part 4 addendum): every product's publish-safe
 * manifest, written into every bundle as `prefab-products.json` — the same
 * "self-host needs a bundle to seed its own runtime store from" reasoning
 * as `prefab-payment-blocks.json`/`prefab-subscription-blocks.json`
 * (payment-manifest.ts/subscription-manifest.ts), but a *different* shape
 * of extraction: a product isn't a block placed on a page, it's the site's
 * own whole collection (already assembled by the caller, exactly like
 * `posts`), so there is no page-scraping to do here — this just maps the
 * collection directly. Deliberately duplicated from `@prefab/schema`'s
 * `ProductDocument` rather than re-exported, for the identical reason
 * form-manifest.ts's own comment gives: @prefab/publish already imports
 * Astro (ADR-0007) and must never become something the self-host runtime
 * has any reason to import.
 *
 * Includes EVERY product, draft included — unlike a Payment/Subscription
 * block (which only ever exists already-placed on an already-published
 * page), `export-bundle`'s own `allProducts` helper is unfiltered, so a
 * bundle produced for self-hosting can genuinely carry a draft product.
 * apps/self-host's own `products-seed.ts`/`cart-checkout-adapters.ts` are
 * what enforce "only ever resolve a published one" from here on — the same
 * `products_public_read` defense-in-depth reasoning (ADR-0018 cart
 * addendum, point 1), reimplemented as a plain SQL `WHERE` clause since
 * SQLite has no RLS to lean on. See this manifest's own `status` field,
 * carried through for exactly that filter.
 */
export interface PublishSafeProductManifest {
  id: string;
  siteId: string;
  title: string;
  /** Cents. */
  price: number;
  currency: string;
  fulfillmentType: FulfillmentType;
  /** null for a digital/service product (nothing to run out of). */
  stockCount: number | null;
  successMessage: string;
  status: ProductStatus;
}

/** Maps a site's own product collection straight through — no page-scraping (see this module's own comment). */
export function extractPublishSafeProducts(products: ProductDocument[]): PublishSafeProductManifest[] {
  return products.map((product) => ({
    id: product.id,
    siteId: product.siteId,
    title: product.title,
    price: product.price,
    currency: product.currency,
    fulfillmentType: product.fulfillmentType,
    stockCount: product.stockCount,
    successMessage: product.successMessage,
    status: product.status,
  }));
}
