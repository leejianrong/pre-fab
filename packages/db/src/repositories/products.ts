import type { PoolClient } from "pg";
import type { FulfillmentType, ProductDocument, ProductStatus } from "@prefab/schema";

interface RawProductRow {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  schema_version: number;
  version: number;
  description: string;
  images: string[];
  price: number;
  currency: string;
  fulfillment_type: FulfillmentType;
  stock_count: number | null;
  success_message: string;
  status: ProductStatus;
}

function rowToProduct(row: RawProductRow): ProductDocument {
  return {
    id: row.id,
    siteId: row.site_id,
    slug: row.slug,
    title: row.title,
    schemaVersion: row.schema_version,
    version: row.version,
    description: row.description,
    images: row.images,
    price: row.price,
    currency: row.currency,
    fulfillmentType: row.fulfillment_type,
    stockCount: row.stock_count,
    successMessage: row.success_message,
    status: row.status,
  };
}

export async function createProduct(
  client: PoolClient,
  input: {
    id: string;
    siteId: string;
    slug: string;
    title: string;
    price: number;
    description?: string;
    images?: string[];
    currency?: string;
    fulfillmentType?: FulfillmentType;
    stockCount?: number | null;
    successMessage?: string;
    status?: ProductStatus;
  },
): Promise<ProductDocument> {
  const fulfillmentType = input.fulfillmentType ?? "physical";
  const stockCount = input.stockCount !== undefined ? input.stockCount : fulfillmentType === "physical" ? 0 : null;
  const result = await client.query<RawProductRow>(
    `INSERT INTO products (id, site_id, slug, title, description, images, price, currency, fulfillment_type, stock_count, success_message, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      input.id,
      input.siteId,
      input.slug,
      input.title,
      input.description ?? "",
      JSON.stringify(input.images ?? []),
      input.price,
      input.currency ?? "usd",
      fulfillmentType,
      stockCount,
      input.successMessage ?? "Thank you for your purchase.",
      input.status ?? "draft",
    ],
  );
  return rowToProduct(result.rows[0]!);
}

export async function getProduct(client: PoolClient, productId: string): Promise<ProductDocument | null> {
  const result = await client.query<RawProductRow>(`SELECT * FROM products WHERE id = $1`, [productId]);
  return result.rows[0] ? rowToProduct(result.rows[0]) : null;
}

/**
 * KAN-1245 / ADR-0018 cart addendum: the runtime's only way to resolve a
 * productId with no tenant context — relies entirely on
 * `products_public_read` (0014_kan1245_cart_checkout.sql), which is scoped
 * to `status = 'published'` (unlike `getPaymentBlockPublic`'s unscoped
 * policy — see that migration's own header comment for why a product can't
 * use the same unscoped shape). Call with `withTenantContext(pool, {})`,
 * same as `getPaymentBlockPublic`. The query itself is identical to
 * `getProduct` above — the difference is entirely in which RLS policy is in
 * effect for the caller's tenant context, not in this function's own SQL.
 */
export async function getProductPublic(client: PoolClient, productId: string): Promise<ProductDocument | null> {
  const result = await client.query<RawProductRow>(`SELECT * FROM products WHERE id = $1`, [productId]);
  return result.rows[0] ? rowToProduct(result.rows[0]) : null;
}

/** Every slug already in use on this site — used to dedupe an auto-generated slug at creation time (@prefab/schema's `dedupeSlug`), same reasoning as `listPostSlugsForSite`. */
export async function listProductSlugsForSite(client: PoolClient, siteId: string): Promise<string[]> {
  const result = await client.query<{ slug: string }>(`SELECT slug FROM products WHERE site_id = $1`, [siteId]);
  return result.rows.map((r) => r.slug);
}

export interface ListProductsOptions {
  /** Clamped to [1, 100]. Default 20. */
  limit?: number;
  /** Clamped to >= 0. Default 0. */
  offset?: number;
  status?: ProductStatus;
}

export interface ListProductsResult {
  products: ProductDocument[];
  total: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Paginated, alphabetical by title (then id as a stable tiebreaker) — a
 * product has no `date` field to order by the way `listPostsForSite` does,
 * so a catalogue listing orders the way a shop shelf does. `total` is the
 * full matching count, independent of `limit`/`offset`, mirroring
 * `listPostsForSite`'s own contract.
 */
export async function listProductsForSite(
  client: PoolClient,
  siteId: string,
  options: ListProductsOptions = {},
): Promise<ListProductsResult> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));

  const whereParts = ["site_id = $1"];
  const params: unknown[] = [siteId];
  if (options.status) {
    params.push(options.status);
    whereParts.push(`status = $${params.length}`);
  }
  const where = whereParts.join(" AND ");

  const countResult = await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM products WHERE ${where}`, params);
  const rowsResult = await client.query<RawProductRow>(
    `SELECT * FROM products WHERE ${where} ORDER BY title ASC, id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return { products: rowsResult.rows.map(rowToProduct), total: Number(countResult.rows[0]!.count) };
}

/** Every product on a site, unpaginated — for the publish pipeline, which needs the whole collection to build routes, not a page of it (mirrors `listAllPostsForSite`). */
export async function listAllProductsForSite(client: PoolClient, siteId: string): Promise<ProductDocument[]> {
  const result = await client.query<RawProductRow>(`SELECT * FROM products WHERE site_id = $1 ORDER BY title ASC, id ASC`, [siteId]);
  return result.rows.map(rowToProduct);
}

export type WriteProductResult = { ok: true; document: ProductDocument } | { ok: false; current: ProductDocument };

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Whole-document write, gated on `expectedVersion` (ADR-0006/R17) — the
 * same discipline as `writePost`, including the idempotent no-op for
 * re-applying identical content (pushing an unmodified export back is
 * never a conflict, R8).
 */
export async function writeProduct(
  client: PoolClient,
  input: {
    productId: string;
    siteId: string;
    slug: string;
    title: string;
    description: string;
    images: string[];
    price: number;
    currency: string;
    fulfillmentType: FulfillmentType;
    stockCount: number | null;
    successMessage: string;
    status: ProductStatus;
    expectedVersion: number;
  },
): Promise<WriteProductResult> {
  const before = await getProduct(client, input.productId);
  if (
    before &&
    before.slug === input.slug &&
    before.title === input.title &&
    before.description === input.description &&
    arraysEqual(before.images, input.images) &&
    before.price === input.price &&
    before.currency === input.currency &&
    before.fulfillmentType === input.fulfillmentType &&
    before.stockCount === input.stockCount &&
    before.successMessage === input.successMessage &&
    before.status === input.status
  ) {
    return { ok: true, document: before };
  }

  const updateResult = await client.query(
    `UPDATE products SET slug = $1, title = $2, description = $3, images = $4, price = $5, currency = $6,
       fulfillment_type = $7, stock_count = $8, success_message = $9, status = $10, version = version + 1, updated_at = now()
     WHERE id = $11 AND site_id = $12 AND version = $13`,
    [
      input.slug,
      input.title,
      input.description,
      JSON.stringify(input.images),
      input.price,
      input.currency,
      input.fulfillmentType,
      input.stockCount,
      input.successMessage,
      input.status,
      input.productId,
      input.siteId,
      input.expectedVersion,
    ],
  );

  if (updateResult.rowCount === 0) {
    const current = await getProduct(client, input.productId);
    if (!current) throw new Error(`product ${input.productId} not found`);
    return { ok: false, current };
  }

  const document = await getProduct(client, input.productId);
  if (!document) throw new Error(`product ${input.productId} vanished mid-write`);
  return { ok: true, document };
}
