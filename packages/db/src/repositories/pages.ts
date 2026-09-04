import type { PoolClient } from "pg";
import type { BlockNode, BlockResponsive, FreePosition, LayoutMode, PageDocument } from "@prefab/schema";

interface RawPageRow {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  schema_version: number;
  version: number;
  layout_mode: LayoutMode;
}

interface RawBlockRow {
  id: string;
  type: string;
  parent: string | null;
  order: number;
  schema_version: number;
  props: Record<string, unknown>;
  responsive: BlockResponsive;
  position: FreePosition | null;
}

function rowToBlockNode(row: RawBlockRow): BlockNode {
  return {
    id: row.id,
    type: row.type,
    parent: row.parent,
    order: Number(row.order),
    schemaVersion: row.schema_version,
    props: row.props,
    responsive: row.responsive,
    ...(row.position ? { position: row.position } : {}),
  };
}

export async function createPage(
  client: PoolClient,
  input: { id: string; siteId: string; slug: string; title: string },
): Promise<PageDocument> {
  const result = await client.query<RawPageRow>(
    `INSERT INTO pages (id, site_id, slug, title) VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.id, input.siteId, input.slug, input.title],
  );
  const row = result.rows[0]!;
  return {
    id: row.id,
    siteId: row.site_id,
    slug: row.slug,
    title: row.title,
    schemaVersion: row.schema_version,
    version: row.version,
    layoutMode: row.layout_mode,
    blocks: [],
  };
}

export async function getPageDocument(client: PoolClient, pageId: string): Promise<PageDocument | null> {
  const pageResult = await client.query<RawPageRow>(`SELECT * FROM pages WHERE id = $1`, [pageId]);
  const pageRow = pageResult.rows[0];
  if (!pageRow) return null;

  const blocksResult = await client.query<RawBlockRow>(`SELECT * FROM blocks WHERE page_id = $1 ORDER BY "order" ASC`, [
    pageId,
  ]);

  return {
    id: pageRow.id,
    siteId: pageRow.site_id,
    slug: pageRow.slug,
    title: pageRow.title,
    schemaVersion: pageRow.schema_version,
    version: pageRow.version,
    layoutMode: pageRow.layout_mode,
    blocks: blocksResult.rows.map(rowToBlockNode),
  };
}

export async function getPageDocumentBySlug(
  client: PoolClient,
  siteId: string,
  slug: string,
): Promise<PageDocument | null> {
  const result = await client.query<{ id: string }>(`SELECT id FROM pages WHERE site_id = $1 AND slug = $2`, [siteId, slug]);
  const id = result.rows[0]?.id;
  return id ? getPageDocument(client, id) : null;
}

export type WritePageResult =
  | { ok: true; document: PageDocument }
  | { ok: false; current: PageDocument };

// jsonb does not preserve the original key order of what was stored, so a
// plain JSON.stringify comparison between a freshly-parsed body and a
// value round-tripped through Postgres can report "different" for
// genuinely identical data. Canonicalize (sort object keys, recursively)
// before comparing.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, v]) => [key, canonicalize(v)]));
  }
  return value;
}

function blocksEqual(a: BlockNode[], b: BlockNode[]): boolean {
  if (a.length !== b.length) return false;
  const sortById = (blocks: BlockNode[]) => [...blocks].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return JSON.stringify(canonicalize(sortById(a))) === JSON.stringify(canonicalize(sortById(b)));
}

/**
 * Whole-document write: fields + full block replace, atomically, gated on
 * `expectedVersion` (ADR-0006 / R17). Never a partial patch — the caller
 * already validated the whole document with @prefab/schema before this is
 * called (R18), so this either applies everything or, on a version
 * mismatch, applies nothing and hands back the current state.
 *
 * Re-applying content identical to what's already stored is always a
 * no-op, independent of `expectedVersion` — pushing an unmodified export
 * back (R8) is never a conflict, and it never churns `version` either
 * (Terraform-shaped idempotent apply, ADR-0002).
 */
export async function writePageDocument(
  client: PoolClient,
  input: {
    pageId: string;
    siteId: string;
    title: string;
    slug: string;
    blocks: BlockNode[];
    expectedVersion: number;
    /**
     * ADR-0014 / KAN-1129. Optional and defaulted to `"flow"` here (rather
     * than required) so every call site that predates free positioning —
     * site.create's default home page, template fork-on-use — keeps
     * working with no change of its own; a caller that cares (page.write)
     * passes the validated document's own `layoutMode` through explicitly.
     */
    layoutMode?: LayoutMode;
  },
): Promise<WritePageResult> {
  const layoutMode: LayoutMode = input.layoutMode ?? "flow";
  const before = await getPageDocument(client, input.pageId);
  if (
    before &&
    before.title === input.title &&
    before.slug === input.slug &&
    before.layoutMode === layoutMode &&
    blocksEqual(before.blocks, input.blocks)
  ) {
    return { ok: true, document: before };
  }

  const updateResult = await client.query(
    `UPDATE pages SET title = $1, slug = $2, layout_mode = $3, version = version + 1, updated_at = now()
     WHERE id = $4 AND site_id = $5 AND version = $6`,
    [input.title, input.slug, layoutMode, input.pageId, input.siteId, input.expectedVersion],
  );

  if (updateResult.rowCount === 0) {
    const current = await getPageDocument(client, input.pageId);
    if (!current) throw new Error(`page ${input.pageId} not found`);
    return { ok: false, current };
  }

  await client.query(`DELETE FROM blocks WHERE page_id = $1`, [input.pageId]);
  for (const block of input.blocks) {
    await client.query(
      `INSERT INTO blocks (id, page_id, site_id, type, parent, "order", schema_version, props, responsive, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        block.id,
        input.pageId,
        input.siteId,
        block.type,
        block.parent,
        block.order,
        block.schemaVersion,
        JSON.stringify(block.props),
        JSON.stringify(block.responsive),
        block.position ? JSON.stringify(block.position) : null,
      ],
    );
  }

  const document = await getPageDocument(client, input.pageId);
  if (!document) throw new Error(`page ${input.pageId} vanished mid-write`);
  return { ok: true, document };
}

export async function listPagesForSite(
  client: PoolClient,
  siteId: string,
): Promise<Array<{ id: string; slug: string; title: string }>> {
  const result = await client.query<{ id: string; slug: string; title: string }>(
    `SELECT id, slug, title FROM pages WHERE site_id = $1 ORDER BY created_at`,
    [siteId],
  );
  return result.rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title }));
}
