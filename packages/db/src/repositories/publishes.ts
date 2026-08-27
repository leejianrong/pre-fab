import type { PoolClient } from "pg";

export interface PublishRow {
  id: string;
  siteId: string;
  bundlePath: string;
  contentHash: string;
  isLive: boolean;
  createdAt: Date;
  createdBy: string;
}

interface RawPublishRow {
  id: string;
  site_id: string;
  bundle_path: string;
  content_hash: string;
  is_live: boolean;
  created_at: Date;
  created_by: string;
}

function rowToPublish(row: RawPublishRow): PublishRow {
  return {
    id: row.id,
    siteId: row.site_id,
    bundlePath: row.bundle_path,
    contentHash: row.content_hash,
    isLive: row.is_live,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export async function createPublish(
  client: PoolClient,
  input: { id: string; siteId: string; bundlePath: string; contentHash: string; createdBy: string },
): Promise<PublishRow> {
  const result = await client.query<RawPublishRow>(
    `INSERT INTO publishes (id, site_id, bundle_path, content_hash, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.id, input.siteId, input.bundlePath, input.contentHash, input.createdBy],
  );
  return rowToPublish(result.rows[0]!);
}

/**
 * The pointer swap (ADR-0007): flip the old live publish off, then the
 * requested one on, inside the same transaction. Immutable bundles plus
 * this one atomic flip are what make R4 (atomic publish) and R5 (instant
 * rollback to *any* previous publish, not just the last one) fall out for
 * free rather than needing their own machinery.
 */
export async function setLivePublish(client: PoolClient, siteId: string, publishId: string): Promise<void> {
  await client.query<RawPublishRow>(`UPDATE publishes SET is_live = false WHERE site_id = $1 AND is_live = true`, [siteId]);
  const result = await client.query<RawPublishRow>(
    `UPDATE publishes SET is_live = true WHERE id = $1 AND site_id = $2`,
    [publishId, siteId],
  );
  if (result.rowCount === 0) {
    throw new Error(`publish ${publishId} not found for site ${siteId}`);
  }
}

export async function getLivePublish(client: PoolClient, siteId: string): Promise<PublishRow | null> {
  const result = await client.query<RawPublishRow>(`SELECT * FROM publishes WHERE site_id = $1 AND is_live = true`, [siteId]);
  return result.rows[0] ? rowToPublish(result.rows[0]) : null;
}

export async function listPublishes(client: PoolClient, siteId: string): Promise<PublishRow[]> {
  const result = await client.query<RawPublishRow>(`SELECT * FROM publishes WHERE site_id = $1 ORDER BY created_at DESC`, [
    siteId,
  ]);
  return result.rows.map(rowToPublish);
}
