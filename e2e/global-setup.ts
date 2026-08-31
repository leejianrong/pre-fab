import "dotenv/config";
import pg from "pg";
import { runMigrations, withTenantContext, createAccount, getAccountByEmail, getOrCreateSubscription, updateSubscription } from "@prefab/db";
import { newUlid } from "@prefab/schema";

const { Pool } = pg;

export const SEED_EMAIL = "e2e-owner@example.com";

/**
 * Runs once before the whole suite: migrates a dedicated `prefab_e2e`
 * database (never prefab_dev/prefab_test, so this suite never fights the
 * package-level integration tests for state), starts from a clean slate,
 * and seeds the one account slice 1's no-signup-UI world needs (SLICES.md).
 */
export default async function globalSetup(): Promise<void> {
  const migrateUrl = process.env.MIGRATE_DATABASE_URL;
  if (!migrateUrl) throw new Error("MIGRATE_DATABASE_URL must be set for e2e — see .env.example");

  const pool = new Pool({ connectionString: migrateUrl });
  try {
    await runMigrations(pool);
    await pool.query(
      "TRUNCATE webhook_deliveries, submissions, form_settings, forms, bookings, booking_widgets, availability_rules, calendar_connections, publishes, blocks, pages, themes, sites, api_tokens, sessions, accounts CASCADE",
    );
    const existing = await withTenantContext(pool, {}, (client) => getAccountByEmail(client, SEED_EMAIL));
    const seeded = existing ?? (await withTenantContext(pool, {}, (client) => createAccount(client, { id: newUlid(), email: SEED_EMAIL })));

    // Slice 8: pre-upgraded to pro so every pre-existing e2e spec (custom
    // domains included) that predates the plan gate keeps working against
    // the shared seeded account with no per-test upgrade step of its own.
    // The gate itself is tested separately, against a dedicated fresh
    // account (billing.spec.ts) — this seed account is never that test's
    // subject.
    await withTenantContext(pool, {}, (client) => getOrCreateSubscription(client, newUlid(), seeded.id));
    await withTenantContext(pool, {}, (client) =>
      updateSubscription(client, seeded.id, {
        plan: "pro",
        status: "active",
        stripeCustomerId: "e2e_seed_cus",
        stripeSubscriptionId: "e2e_seed_sub",
      }),
    );
  } finally {
    await pool.end();
  }
}
