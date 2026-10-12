import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleStoreDir = path.join(repoRoot, "e2e", ".data", "bundles");
const assetStoreDir = path.join(repoRoot, "e2e", ".data", "assets");

// This sandboxed dev environment pre-installs Chromium at a revision
// Playwright's own resolver doesn't expect, and points this at it directly
// rather than triggering a (blocked) download — see environment notes.
// CI (and any normal machine) has no such path and installs its own
// Chromium via `playwright install`, so this is opt-in only when present.
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";
const launchOptions = existsSync(PREINSTALLED_CHROMIUM) ? { executablePath: PREINSTALLED_CHROMIUM } : undefined;

// KAN-1324: Postgres host port. scripts/dev-ports.sh bumps
// PREFAB_POSTGRES_PORT in this worktree's .env when 5432 is taken, so read the
// same variable (shell env wins over .env; both default to 5432).
dotenv.config({ path: path.join(repoRoot, ".env") });
const pgPort = process.env.PREFAB_POSTGRES_PORT || "5432";
const migrateUrl = `postgres://prefab:prefab@localhost:${pgPort}/prefab_e2e`;
// globalSetup runs in this process after the config loads and reads
// MIGRATE_DATABASE_URL — keep it on the same DB/port as the API.
process.env.MIGRATE_DATABASE_URL = migrateUrl;

const apiEnv = {
  DATABASE_URL: `postgres://prefab_app:prefab_app@localhost:${pgPort}/prefab_e2e`,
  MIGRATE_DATABASE_URL: migrateUrl,
  API_PORT: "8788",
  EDITOR_ORIGIN: "http://localhost:5174",
  BUNDLE_STORE_DIR: bundleStoreDir,
  ASSET_STORE_DIR: assetStoreDir,
  // Slice 6: where a published page's Form island posts submissions to —
  // the same origin bundle serving itself runs on (apps/api serves both).
  RUNTIME_API_URL: "http://localhost:8788",
};

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions,
  },
  webServer: [
    {
      command: "pnpm --filter @prefab/api run start",
      url: "http://localhost:8788/health",
      cwd: repoRoot,
      env: apiEnv,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @prefab/editor exec vite --port 5174",
      url: "http://localhost:5174",
      cwd: repoRoot,
      env: { VITE_PREFAB_API_URL: "", PREFAB_API_PROXY_TARGET: "http://localhost:8788" },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
