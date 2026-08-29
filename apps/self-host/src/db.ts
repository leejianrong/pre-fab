import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const SCHEMA_SQL = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql"), "utf8");

export type SelfHostDb = Database.Database;

/**
 * Opens (creating if absent) the self-host runtime's own SQLite database
 * and applies its schema idempotently. This is the whole "install a
 * database" step (ADR-0010 tier b) — no separate migration runner, no
 * network, no credentials beyond a file path.
 */
export function openSelfHostDb(dbPath: string): SelfHostDb {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  return db;
}
