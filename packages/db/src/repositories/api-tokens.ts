import type { PoolClient } from "pg";

/** Per-site scoped, expiring, revocable — the credential the CLI and MCP authenticate with (ADR-0001, ADR-0003). */
export interface ApiToken {
  id: string;
  siteId: string;
  accountId: string;
  name: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface ApiTokenRow {
  id: string;
  site_id: string;
  account_id: string;
  name: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

function rowToApiToken(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    siteId: row.site_id,
    accountId: row.account_id,
    name: row.name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export async function createApiToken(
  client: PoolClient,
  input: { id: string; siteId: string; accountId: string; name: string; tokenHash: string; expiresAt: Date },
): Promise<ApiToken> {
  const result = await client.query<ApiTokenRow>(
    `INSERT INTO api_tokens (id, site_id, account_id, name, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.id, input.siteId, input.accountId, input.name, input.tokenHash, input.expiresAt],
  );
  return rowToApiToken(result.rows[0]!);
}

/** Null for a token that does not exist, has expired, or was revoked — those are indistinguishable to a caller. */
export async function findActiveApiTokenByHash(client: PoolClient, tokenHash: string): Promise<ApiToken | null> {
  const result = await client.query<ApiTokenRow>(
    `SELECT * FROM api_tokens WHERE token_hash = $1 AND expires_at > now() AND revoked_at IS NULL`,
    [tokenHash],
  );
  return result.rows[0] ? rowToApiToken(result.rows[0]) : null;
}

export async function revokeApiToken(client: PoolClient, id: string): Promise<void> {
  await client.query(`UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [id]);
}
