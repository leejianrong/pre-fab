import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { newUlid, buildExportManifest, checkExportManifestCompatible, type PageDocument } from "@prefab/schema";
import { withTenantContext, runMigrations, createAccount } from "@prefab/db";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

const { Pool } = pg;

const migrateUrl = process.env.MIGRATE_DATABASE_URL_TEST;
const appUrl = process.env.DATABASE_URL_TEST;
if (!migrateUrl || !appUrl) {
  throw new Error("MIGRATE_DATABASE_URL_TEST and DATABASE_URL_TEST must be set — see .env.example");
}

const migratePool = new Pool({ connectionString: migrateUrl });
const appPool = new Pool({ connectionString: appUrl });

let app: FastifyInstance;

beforeAll(async () => {
  await runMigrations(migratePool);
  app = buildApp({ pool: appPool, bundleStoreDir: "/tmp/pf-export-manifest-unused-bundles", assetStoreDir: "/tmp/pf-export-manifest-unused-assets" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await migratePool.end();
  await appPool.end();
});

async function seedAccountAndLogin(email: string) {
  await withTenantContext(migratePool, {}, (client) => createAccount(client, { id: newUlid(), email }));
  const login = await app.inject({ method: "POST", url: "/v1/dev/login", payload: { email } });
  expect(login.statusCode).toBe(200);
  const cookieHeader = login.headers["set-cookie"];
  const cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  return cookie!.split(";")[0]!;
}

// SLICES.md Slice 7 integration test: "An export from a two-versions-old
// schema imports successfully." This repo's document schemaVersion has
// only ever been 1 — there is no real multi-version history yet to export
// a genuinely two-versions-old document from — so `currentSchemaVersion`
// is injected here the same way this repo already injects "what isn't
// real yet" everywhere else (FakeDomainProvider, FakeTurnstileVerifier):
// a manifest declaring today's real schemaVersion is checked against a
// *simulated* future build two versions ahead, and the underlying page
// document — real, from a real site, against real Postgres — is proven to
// still import (a real write, accepted) regardless.
describe("export manifest compatibility (Slice 7, ADR-0010 tier a, QUESTIONS.md 12.3)", () => {
  it("accepts an export from a schemaVersion two builds behind current, and its document still imports for real", async () => {
    const cookie = await seedAccountAndLogin(`export-manifest-${newUlid()}@example.com`);
    const created = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie },
      payload: { slug: `export-manifest-${newUlid()}`, name: "Export Manifest Test" },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json() as { site: { id: string; schemaVersion: number }; page: PageDocument };

    const manifest = buildExportManifest({ schemaVersion: body.site.schemaVersion });
    const simulatedFutureVersion = body.site.schemaVersion + 2;

    expect(checkExportManifestCompatible(manifest, simulatedFutureVersion)).toEqual({ compatible: true });
    expect(checkExportManifestCompatible(manifest, simulatedFutureVersion + 1).compatible).toBe(false);

    // The document itself imports through the exact same write path any
    // other push/import does — no special-cased "old export" code path,
    // because migrateBlockProps already runs unconditionally in
    // validatePageDocument regardless of what a manifest declares.
    const reimport = await app.inject({
      method: "PUT",
      url: `/v1/sites/${body.site.id}/pages/${body.page.id}`,
      headers: { cookie },
      payload: {
        title: body.page.title,
        slug: body.page.slug,
        blocks: body.page.blocks,
        expectedVersion: body.page.version,
      },
    });
    expect(reimport.statusCode).toBe(200);
  });
});
