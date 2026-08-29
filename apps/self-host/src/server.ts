import path from "node:path";
import { buildApp } from "./app.js";
import { openSelfHostDb } from "./db.js";
import { seedFormsFromBundle } from "./forms-seed.js";
import { retryDueWebhookDeliveries } from "./lib/webhooks.js";

/**
 * Single-command start (ADR-0010 tier b, SLICES.md's "documented
 * single-command start"): three env vars, no other pre-fab
 * infrastructure required or contacted (R10). See this package's README
 * for the full configuration surface.
 */
const port = Number(process.env.PORT ?? 8080);
const bundleDir = path.resolve(process.env.BUNDLE_DIR ?? "./site");
const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");
const dbPath = path.join(dataDir, "prefab.db");

async function main(): Promise<void> {
  const db = openSelfHostDb(dbPath);
  const formCount = await seedFormsFromBundle(db, bundleDir);
  console.log(`prefab self-host: seeded ${formCount} form(s) from ${bundleDir}`);

  const app = buildApp({ bundleDir, db });

  // Opportunistic retry on every submission (app.ts) is the primary path;
  // this periodic sweep is what still retries a failed delivery on an
  // instance that receives no further traffic — same reasoning
  // apps/api/src/lib/webhooks.ts documents for why there's no real job
  // queue, applied on a timer since self-host has no per-request piggyback
  // moment to rely on beyond the one submission that failed.
  const webhookSweepInterval = setInterval(() => {
    void retryDueWebhookDeliveries(db).catch((error) => console.error("webhook retry sweep failed", error));
  }, 60_000);
  webhookSweepInterval.unref();

  await app.listen({ port, host: "0.0.0.0" });
  console.log(`prefab self-host listening on :${port}, serving ${bundleDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
