import type { PoolClient } from "pg";

export interface Account {
  id: string;
  email: string;
  createdAt: Date;
  emailVerifiedAt: Date | null;
  verificationCodeHash: string | null;
  verificationCodeExpiresAt: Date | null;
}

interface AccountRow {
  id: string;
  email: string;
  created_at: Date;
  email_verified_at: Date | null;
  verification_code_hash: string | null;
  verification_code_expires_at: Date | null;
}

function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    emailVerifiedAt: row.email_verified_at,
    verificationCodeHash: row.verification_code_hash,
    verificationCodeExpiresAt: row.verification_code_expires_at,
  };
}

export async function createAccount(
  client: PoolClient,
  input: { id: string; email: string },
): Promise<Account> {
  const result = await client.query<AccountRow>(
    `INSERT INTO accounts (id, email) VALUES ($1, $2) RETURNING *`,
    [input.id, input.email],
  );
  return rowToAccount(result.rows[0]!);
}

export async function getAccount(client: PoolClient, id: string): Promise<Account | null> {
  const result = await client.query<AccountRow>(`SELECT * FROM accounts WHERE id = $1`, [id]);
  return result.rows[0] ? rowToAccount(result.rows[0]) : null;
}

export async function getAccountByEmail(client: PoolClient, email: string): Promise<Account | null> {
  const result = await client.query<AccountRow>(`SELECT * FROM accounts WHERE email = $1`, [email]);
  return result.rows[0] ? rowToAccount(result.rows[0]) : null;
}

/**
 * Signup (Slice 3): stamps a fresh verification code hash + expiry on the
 * account, replacing any previous one — a repeat "resend" always
 * invalidates the code before it, never lets two codes be valid at once.
 */
export async function setVerificationCode(
  client: PoolClient,
  accountId: string,
  input: { codeHash: string; expiresAt: Date },
): Promise<Account> {
  const result = await client.query<AccountRow>(
    `UPDATE accounts SET verification_code_hash = $1, verification_code_expires_at = $2 WHERE id = $3 RETURNING *`,
    [input.codeHash, input.expiresAt, accountId],
  );
  if (!result.rows[0]) throw new Error(`account ${accountId} not found`);
  return rowToAccount(result.rows[0]);
}

/** Marks the account verified and clears the one-time code so it cannot be replayed. */
export async function markEmailVerified(client: PoolClient, accountId: string): Promise<Account> {
  const result = await client.query<AccountRow>(
    `UPDATE accounts
     SET email_verified_at = now(), verification_code_hash = NULL, verification_code_expires_at = NULL
     WHERE id = $1 RETURNING *`,
    [accountId],
  );
  if (!result.rows[0]) throw new Error(`account ${accountId} not found`);
  return rowToAccount(result.rows[0]);
}
