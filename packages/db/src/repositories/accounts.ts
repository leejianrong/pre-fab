import type { PoolClient } from "pg";

export interface Account {
  id: string;
  email: string;
  createdAt: Date;
}

interface AccountRow {
  id: string;
  email: string;
  created_at: Date;
}

function rowToAccount(row: AccountRow): Account {
  return { id: row.id, email: row.email, createdAt: row.created_at };
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
