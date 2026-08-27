import "dotenv/config";
import pg from "pg";
import { runMigrations } from "../migrate.js";

const { Pool } = pg;

const connectionString = process.env.MIGRATE_DATABASE_URL;
if (!connectionString) {
  console.error("MIGRATE_DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

const pool = new Pool({ connectionString });
try {
  const ran = await runMigrations(pool);
  console.log(ran.length > 0 ? `applied: ${ran.join(", ")}` : "already up to date");
} finally {
  await pool.end();
}
