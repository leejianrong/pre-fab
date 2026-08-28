import type { PoolClient } from "pg";
import type { PostDocument, PostStatus } from "@prefab/schema";

interface RawPostRow {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  schema_version: number;
  version: number;
  date: string | Date;
  author: string;
  tags: string[];
  cover: string | null;
  body: string;
  locale: string;
  status: PostStatus;
}

// node-postgres parses a `date`-typed column into a JS Date (midnight UTC)
// rather than handing back the "YYYY-MM-DD" string Postgres itself stores
// — reformat it here so PostDocument.date always matches the string
// PostDocumentSchema validates (and what a hand-edited file round-trips).
function formatDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function rowToPost(row: RawPostRow): PostDocument {
  return {
    id: row.id,
    siteId: row.site_id,
    slug: row.slug,
    title: row.title,
    schemaVersion: row.schema_version,
    version: row.version,
    date: formatDate(row.date),
    author: row.author,
    tags: row.tags,
    cover: row.cover,
    body: row.body,
    locale: row.locale,
    status: row.status,
  };
}

export async function createPost(
  client: PoolClient,
  input: {
    id: string;
    siteId: string;
    slug: string;
    title: string;
    date: string;
    author?: string;
    tags?: string[];
    cover?: string | null;
    body?: string;
    locale?: string;
    status?: PostStatus;
  },
): Promise<PostDocument> {
  const result = await client.query<RawPostRow>(
    `INSERT INTO posts (id, site_id, slug, title, date, author, tags, cover, body, locale, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      input.id,
      input.siteId,
      input.slug,
      input.title,
      input.date,
      input.author ?? "",
      JSON.stringify(input.tags ?? []),
      input.cover ?? null,
      input.body ?? "",
      input.locale ?? "en",
      input.status ?? "draft",
    ],
  );
  return rowToPost(result.rows[0]!);
}

export async function getPost(client: PoolClient, postId: string): Promise<PostDocument | null> {
  const result = await client.query<RawPostRow>(`SELECT * FROM posts WHERE id = $1`, [postId]);
  return result.rows[0] ? rowToPost(result.rows[0]) : null;
}

/** Every slug already in use on this site — used to dedupe an auto-generated slug at creation time (@prefab/schema's `dedupeSlug`). */
export async function listPostSlugsForSite(client: PoolClient, siteId: string): Promise<string[]> {
  const result = await client.query<{ slug: string }>(`SELECT slug FROM posts WHERE site_id = $1`, [siteId]);
  return result.rows.map((r) => r.slug);
}

export interface ListPostsOptions {
  /** Clamped to [1, 100]. Default 20. */
  limit?: number;
  /** Clamped to >= 0. Default 0. */
  offset?: number;
  status?: PostStatus;
}

export interface ListPostsResult {
  posts: PostDocument[];
  total: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Paginated, newest-first (by date, then id as a stable tiebreaker so equal
 * dates still order consistently across pages). `total` is the full
 * matching count, independent of `limit`/`offset`, so a caller can compute
 * page boundaries without a second round trip.
 */
export async function listPostsForSite(
  client: PoolClient,
  siteId: string,
  options: ListPostsOptions = {},
): Promise<ListPostsResult> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));

  const whereParts = ["site_id = $1"];
  const params: unknown[] = [siteId];
  if (options.status) {
    params.push(options.status);
    whereParts.push(`status = $${params.length}`);
  }
  const where = whereParts.join(" AND ");

  const countResult = await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM posts WHERE ${where}`, params);
  const rowsResult = await client.query<RawPostRow>(
    `SELECT * FROM posts WHERE ${where} ORDER BY date DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return { posts: rowsResult.rows.map(rowToPost), total: Number(countResult.rows[0]!.count) };
}

/** Every post on a site, unpaginated — for the publish pipeline, which needs the whole collection to build routes/RSS/sitemap, not a page of it. */
export async function listAllPostsForSite(client: PoolClient, siteId: string): Promise<PostDocument[]> {
  const result = await client.query<RawPostRow>(`SELECT * FROM posts WHERE site_id = $1 ORDER BY date DESC, id DESC`, [siteId]);
  return result.rows.map(rowToPost);
}

export type WritePostResult = { ok: true; document: PostDocument } | { ok: false; current: PostDocument };

function tagsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

/**
 * Whole-document write, gated on `expectedVersion` (ADR-0006/R17) — the
 * same discipline as `writePageDocument`, including the idempotent no-op
 * for re-applying identical content (pushing an unmodified export back is
 * never a conflict, R8).
 */
export async function writePost(
  client: PoolClient,
  input: {
    postId: string;
    siteId: string;
    slug: string;
    title: string;
    date: string;
    author: string;
    tags: string[];
    cover: string | null;
    body: string;
    locale: string;
    status: PostStatus;
    expectedVersion: number;
  },
): Promise<WritePostResult> {
  const before = await getPost(client, input.postId);
  if (
    before &&
    before.slug === input.slug &&
    before.title === input.title &&
    before.date === input.date &&
    before.author === input.author &&
    tagsEqual(before.tags, input.tags) &&
    before.cover === input.cover &&
    before.body === input.body &&
    before.locale === input.locale &&
    before.status === input.status
  ) {
    return { ok: true, document: before };
  }

  const updateResult = await client.query(
    `UPDATE posts SET slug = $1, title = $2, date = $3, author = $4, tags = $5, cover = $6, body = $7,
       locale = $8, status = $9, version = version + 1, updated_at = now()
     WHERE id = $10 AND site_id = $11 AND version = $12`,
    [
      input.slug,
      input.title,
      input.date,
      input.author,
      JSON.stringify(input.tags),
      input.cover,
      input.body,
      input.locale,
      input.status,
      input.postId,
      input.siteId,
      input.expectedVersion,
    ],
  );

  if (updateResult.rowCount === 0) {
    const current = await getPost(client, input.postId);
    if (!current) throw new Error(`post ${input.postId} not found`);
    return { ok: false, current };
  }

  const document = await getPost(client, input.postId);
  if (!document) throw new Error(`post ${input.postId} vanished mid-write`);
  return { ok: true, document };
}
