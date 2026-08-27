import pg, { type PoolConfig } from "pg";

const { Pool } = pg;

export function createPool(config: PoolConfig | string): pg.Pool {
  return new Pool(typeof config === "string" ? { connectionString: config } : config);
}

export type { Pool, PoolClient } from "pg";
