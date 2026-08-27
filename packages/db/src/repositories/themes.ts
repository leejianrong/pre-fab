import type { PoolClient } from "pg";
import type { ThemeDocument, ThemeTokens } from "@prefab/schema";

interface RawThemeRow {
  id: string;
  site_id: string;
  schema_version: number;
  tokens: ThemeTokens;
}

function rowToTheme(row: RawThemeRow): ThemeDocument {
  return {
    id: row.id,
    siteId: row.site_id,
    schemaVersion: row.schema_version,
    tokens: row.tokens,
  };
}

export async function createTheme(
  client: PoolClient,
  input: { id: string; siteId: string; tokens: ThemeTokens },
): Promise<ThemeDocument> {
  const result = await client.query<RawThemeRow>(
    `INSERT INTO themes (id, site_id, tokens) VALUES ($1, $2, $3) RETURNING *`,
    [input.id, input.siteId, JSON.stringify(input.tokens)],
  );
  return rowToTheme(result.rows[0]!);
}

export async function getTheme(client: PoolClient, siteId: string): Promise<ThemeDocument | null> {
  const result = await client.query<RawThemeRow>(`SELECT * FROM themes WHERE site_id = $1`, [siteId]);
  return result.rows[0] ? rowToTheme(result.rows[0]) : null;
}

export async function updateThemeTokens(
  client: PoolClient,
  siteId: string,
  tokens: ThemeTokens,
): Promise<ThemeDocument> {
  const result = await client.query<RawThemeRow>(
    `UPDATE themes SET tokens = $1, updated_at = now() WHERE site_id = $2 RETURNING *`,
    [JSON.stringify(tokens), siteId],
  );
  if (!result.rows[0]) throw new Error(`no theme for site ${siteId}`);
  return rowToTheme(result.rows[0]);
}
