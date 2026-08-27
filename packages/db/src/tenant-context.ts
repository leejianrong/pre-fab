import type { Pool, PoolClient } from "pg";

export interface TenantContext {
  siteId?: string;
  accountId?: string;
}

/**
 * The whole enforcement mechanism for ADR-0008 lives here: every tenant-data
 * query runs inside a transaction with `app.site_id` / `app.account_id` set
 * via `set_config(..., true)` (transaction-local, never a raw `SET LOCAL`
 * string interpolation). The RLS policies in migrations/0001_init.sql read
 * these back with `current_setting(..., true)`. No context set means both
 * read back as `''`, which cannot equal any real ULID — fail closed.
 */
export async function withTenantContext<T>(
  pool: Pool,
  context: TenantContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.site_id', $1, true)", [context.siteId ?? ""]);
    await client.query("SELECT set_config('app.account_id', $1, true)", [context.accountId ?? ""]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
