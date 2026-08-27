import type { PoolClient } from "pg";

export interface SiteRow {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

interface RawSiteRow {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
  schema_version: number;
  created_at: Date;
  updated_at: Date;
}

function rowToSite(row: RawSiteRow): SiteRow {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ownerId: row.owner_id,
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Insert satisfies the `sites_owner_access` RLS policy only when ctx.accountId === input.ownerId. */
export async function createSite(
  client: PoolClient,
  input: { id: string; slug: string; name: string; ownerId: string },
): Promise<SiteRow> {
  const result = await client.query<RawSiteRow>(
    `INSERT INTO sites (id, slug, name, owner_id) VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.id, input.slug, input.name, input.ownerId],
  );
  return rowToSite(result.rows[0]!);
}

export async function getSite(client: PoolClient, id: string): Promise<SiteRow | null> {
  const result = await client.query<RawSiteRow>(`SELECT * FROM sites WHERE id = $1`, [id]);
  return result.rows[0] ? rowToSite(result.rows[0]) : null;
}

export async function listSitesForAccount(client: PoolClient, accountId: string): Promise<SiteRow[]> {
  const result = await client.query<RawSiteRow>(`SELECT * FROM sites WHERE owner_id = $1 ORDER BY created_at`, [accountId]);
  return result.rows.map(rowToSite);
}
