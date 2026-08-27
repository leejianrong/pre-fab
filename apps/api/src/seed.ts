import "dotenv/config";
import pg from "pg";
import { newUlid } from "@prefab/schema";
import { withTenantContext, createAccount, getAccountByEmail } from "@prefab/db";

const { Pool } = pg;

const SEED_EMAIL = process.env.SEED_ACCOUNT_EMAIL ?? "owner@example.com";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

const pool = new Pool({ connectionString });

try {
  const existing = await withTenantContext(pool, {}, (client) => getAccountByEmail(client, SEED_EMAIL));
  if (existing) {
    console.log(`account already seeded: ${existing.email} (${existing.id})`);
  } else {
    const account = await withTenantContext(pool, {}, (client) => createAccount(client, { id: newUlid(), email: SEED_EMAIL }));
    console.log(`seeded account: ${account.email} (${account.id})`);
  }
  console.log(`\nLog in via: POST /v1/dev/login { "email": "${SEED_EMAIL}" }`);
} finally {
  await pool.end();
}
