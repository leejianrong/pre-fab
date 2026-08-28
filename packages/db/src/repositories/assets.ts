import type { PoolClient } from "pg";

export interface AssetVariant {
  width: number;
  /** Storage key (content-addressed, portable) — resolved to a URL by the caller, never stored as one. */
  key: string;
}

export interface AssetRecord {
  id: string;
  siteId: string;
  sha256: string;
  contentType: string;
  byteSize: number;
  filename: string;
  width: number | null;
  height: number | null;
  variants: AssetVariant[];
  createdAt: string;
  createdBy: string;
}

interface RawAssetRow {
  id: string;
  site_id: string;
  sha256: string;
  content_type: string;
  byte_size: number;
  filename: string;
  width: number | null;
  height: number | null;
  variants: AssetVariant[];
  created_at: string;
  created_by: string;
}

function rowToAsset(row: RawAssetRow): AssetRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    sha256: row.sha256,
    contentType: row.content_type,
    byteSize: row.byte_size,
    filename: row.filename,
    width: row.width,
    height: row.height,
    variants: row.variants,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export async function getAssetBySha256(client: PoolClient, siteId: string, sha256: string): Promise<AssetRecord | null> {
  const result = await client.query<RawAssetRow>(`SELECT * FROM assets WHERE site_id = $1 AND sha256 = $2`, [
    siteId,
    sha256,
  ]);
  return result.rows[0] ? rowToAsset(result.rows[0]) : null;
}

export async function getAsset(client: PoolClient, siteId: string, assetId: string): Promise<AssetRecord | null> {
  const result = await client.query<RawAssetRow>(`SELECT * FROM assets WHERE site_id = $1 AND id = $2`, [
    siteId,
    assetId,
  ]);
  return result.rows[0] ? rowToAsset(result.rows[0]) : null;
}

/**
 * Content-addressed by (site_id, sha256) — the same unique constraint the
 * 0002_slice2.sql migration puts on the table. The caller (apps/api) always
 * checks `getAssetBySha256` first and skips both the file write and this
 * insert entirely on a hit, so an identical re-upload is a genuine no-op,
 * not a second row racing this one; this insert is the "first upload of
 * these bytes" path only.
 */
export async function createAsset(
  client: PoolClient,
  input: {
    id: string;
    siteId: string;
    sha256: string;
    contentType: string;
    byteSize: number;
    filename: string;
    width: number | null;
    height: number | null;
    variants: AssetVariant[];
    createdBy: string;
  },
): Promise<AssetRecord> {
  const result = await client.query<RawAssetRow>(
    `INSERT INTO assets (id, site_id, sha256, content_type, byte_size, filename, width, height, variants, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.id,
      input.siteId,
      input.sha256,
      input.contentType,
      input.byteSize,
      input.filename,
      input.width,
      input.height,
      JSON.stringify(input.variants),
      input.createdBy,
    ],
  );
  return rowToAsset(result.rows[0]!);
}

export async function listAssetsForSite(client: PoolClient, siteId: string): Promise<AssetRecord[]> {
  const result = await client.query<RawAssetRow>(`SELECT * FROM assets WHERE site_id = $1 ORDER BY created_at DESC`, [
    siteId,
  ]);
  return result.rows.map(rowToAsset);
}
