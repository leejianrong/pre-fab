import type { PoolClient } from "pg";
import { resolveThemeTokens, type ThemeDocument, type ThemeTokens } from "@prefab/schema";

interface RawThemeRow {
  id: string;
  site_id: string;
  schema_version: number;
  tokens: ThemeTokens;
}

/**
 * KAN-1204: every reader of a `ThemeDocument` from here on gets a complete,
 * current-shape `tokens` object, backfilled against `DEFAULT_THEME_TOKENS`
 * for any group a stored row predates — the same "defaults underneath, the
 * theme's own value wins" merge `resolveThemeTokens` already does for
 * *rendering* (@prefab/blocks' theme-css.ts / @prefab/publish's
 * page-template.ts), applied here at the DB-read boundary instead.
 *
 * Why this boundary needs it too, not just render time: apps/api's
 * `GET /v1/sites/:siteId/theme` returns whatever this repository hands back
 * with no further processing (apps/api/src/app.ts), and
 * apps/editor/src/ThemeEditor.tsx reads `tokens[group]` directly off that
 * response (never through `resolveThemeTokens`) to build its per-group
 * editing UI. A theme document created before a token group existed — every
 * site created before `fontFamily`, now every site created before
 * `lineHeight` — would otherwise come back from a raw `SELECT *` genuinely
 * missing that key, and the editor would render an empty, uneditable
 * section for it (nothing in ThemeEditor's UI adds a new field to a group,
 * only edits existing ones) rather than the platform's own sane defaults.
 * No SQL migration needed for existing rows: this backfills on every read,
 * and a save from the editor (which round-trips through this same resolved
 * shape) persists the complete object from then on.
 */
function rowToTheme(row: RawThemeRow): ThemeDocument {
  return {
    id: row.id,
    siteId: row.site_id,
    schemaVersion: row.schema_version,
    tokens: resolveThemeTokens(row.tokens),
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
