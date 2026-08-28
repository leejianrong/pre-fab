import "dotenv/config";
import path from "node:path";
import pg from "pg";
import { buildApp } from "./app.js";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set (see .env.example) — apps/api connects as prefab_app, not prefab");
  process.exit(1);
}

const pool = new Pool({ connectionString });
const bundleStoreDir = path.resolve(process.env.BUNDLE_STORE_DIR ?? ".data/bundles");
const assetStoreDir = path.resolve(process.env.ASSET_STORE_DIR ?? ".data/assets");
const port = Number(process.env.API_PORT ?? 8787);
const platformHost = process.env.PUBLIC_SITE_HOST ?? "prefab.local";

const app = buildApp({ pool, bundleStoreDir, assetStoreDir, platformHost });

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`prefab api listening on :${port}`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
