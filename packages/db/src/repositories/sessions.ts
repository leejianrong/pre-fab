import type { PoolClient } from "pg";

export interface Session {
  id: string;
  accountId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
}

interface SessionRow {
  id: string;
  account_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    accountId: row.account_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function createSession(
  client: PoolClient,
  input: { id: string; accountId: string; tokenHash: string; expiresAt: Date },
): Promise<Session> {
  const result = await client.query<SessionRow>(
    `INSERT INTO sessions (id, account_id, token_hash, expires_at) VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.id, input.accountId, input.tokenHash, input.expiresAt],
  );
  return rowToSession(result.rows[0]!);
}

/** Returns null for a token that does not exist or has expired — callers never learn which. */
export async function findActiveSessionByHash(client: PoolClient, tokenHash: string): Promise<Session | null> {
  const result = await client.query<SessionRow>(
    `SELECT * FROM sessions WHERE token_hash = $1 AND expires_at > now()`,
    [tokenHash],
  );
  return result.rows[0] ? rowToSession(result.rows[0]) : null;
}
