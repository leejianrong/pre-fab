import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { newUlid, type PageDocument } from "@prefab/schema";
import { withTenantContext, runMigrations, createAccount } from "@prefab/db";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

interface CreatedSite {
  site: { id: string };
  page: PageDocument;
}

interface OutlineBody {
  pages: Array<{ id: string; blocks: Array<{ id: string; type: string; summary: string }> }>;
}

const { Pool } = pg;

const migrateUrl = process.env.MIGRATE_DATABASE_URL_TEST;
const appUrl = process.env.DATABASE_URL_TEST;
if (!migrateUrl || !appUrl) {
  throw new Error("MIGRATE_DATABASE_URL_TEST and DATABASE_URL_TEST must be set — see .env.example");
}

const migratePool = new Pool({ connectionString: migrateUrl });
const appPool = new Pool({ connectionString: appUrl });

let app: FastifyInstance;
let bundleStoreDir: string;

beforeAll(async () => {
  await runMigrations(migratePool);
  await migratePool.query("TRUNCATE publishes, blocks, pages, themes, sites, api_tokens, sessions, accounts CASCADE");
  bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-api-bundles-"));
  app = buildApp({ pool: appPool, bundleStoreDir });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await migratePool.end();
  await appPool.end();
  if (bundleStoreDir) await rm(bundleStoreDir, { recursive: true, force: true });
});

async function seedAccountAndLogin(email: string) {
  await withTenantContext(migratePool, {}, (client) => createAccount(client, { id: newUlid(), email }));
  const login = await app.inject({ method: "POST", url: "/v1/dev/login", payload: { email } });
  expect(login.statusCode).toBe(200);
  const cookieHeader = login.headers["set-cookie"];
  const cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  return { cookie: cookie!.split(";")[0]!, accountId: (login.json() as { accountId: string }).accountId };
}

describe("apps/api — the one write path", () => {
  it("creates a site with a default home page and Hero block, and enforces auth", async () => {
    const { cookie } = await seedAccountAndLogin(`site-${newUlid()}@example.com`);

    const noAuth = await app.inject({ method: "POST", url: "/v1/sites", payload: { slug: "s", name: "S" } });
    expect(noAuth.statusCode).toBe(401);

    const created = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie },
      payload: { slug: `demo-${newUlid()}`, name: "Demo" },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json() as { site: { id: string }; page: { blocks: Array<{ type: string }> } };
    expect(body.page.blocks).toHaveLength(1);
    expect(body.page.blocks[0]?.type).toBe("hero");
  });

  it("rejects a write with an unrecognised field, naming the block id and path (R18), and applies nothing", async () => {
    const { cookie } = await seedAccountAndLogin(`r18-${newUlid()}@example.com`);
    const created = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie },
      payload: { slug: `r18-${newUlid()}`, name: "R18" },
    });
    const { site, page } = created.json() as CreatedSite;

    const badBlockId = newUlid();
    const write = await app.inject({
      method: "PUT",
      url: `/v1/sites/${site.id}/pages/${page.id}`,
      headers: { cookie },
      payload: {
        title: page.title,
        slug: page.slug,
        blocks: [
          { ...page.blocks[0], props: { heading: "kept" } },
          { id: badBlockId, type: "hero", parent: null, order: 2000, schemaVersion: 1, props: { heading: "bad", nope: true } },
        ],
        expectedVersion: page.version,
      },
    });

    expect(write.statusCode).toBe(400);
    const errorBody = write.json() as { error: { code: string; details: Array<{ blockId: string }> } };
    expect(errorBody.error.code).toBe("validation_error");
    expect(errorBody.error.details.some((i) => i.blockId === badBlockId)).toBe(true);

    const reread = await app.inject({ method: "GET", url: `/v1/sites/${site.id}/pages/${page.id}`, headers: { cookie } });
    expect((reread.json() as PageDocument).blocks[0].props.heading).not.toBe("kept");
  });

  it("rejects a stale write with a diff and exit-mappable conflict code, and leaves the prior write intact (R17)", async () => {
    const { cookie } = await seedAccountAndLogin(`r17-${newUlid()}@example.com`);
    const created = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie },
      payload: { slug: `r17-${newUlid()}`, name: "R17" },
    });
    const { site, page } = created.json() as CreatedSite;

    const firstWrite = await app.inject({
      method: "PUT",
      url: `/v1/sites/${site.id}/pages/${page.id}`,
      headers: { cookie },
      payload: { title: "First", slug: page.slug, blocks: page.blocks, expectedVersion: page.version },
    });
    expect(firstWrite.statusCode).toBe(200);

    const staleWrite = await app.inject({
      method: "PUT",
      url: `/v1/sites/${site.id}/pages/${page.id}`,
      headers: { cookie },
      payload: { title: "Stale", slug: page.slug, blocks: page.blocks, expectedVersion: page.version },
    });
    expect(staleWrite.statusCode).toBe(409);
    const conflictBody = staleWrite.json() as { error: { code: string; details: { current: { title: string } } } };
    expect(conflictBody.error.code).toBe("conflict");
    expect(conflictBody.error.details.current.title).toBe("First");
  });

  it("publishes, serves the live bundle, then rolls back to the previous publish (R4/R5)", async () => {
    const { cookie } = await seedAccountAndLogin(`publish-${newUlid()}@example.com`);
    const created = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie },
      payload: { slug: `publish-${newUlid()}`, name: "Publish" },
    });
    const { site, page } = created.json() as CreatedSite;

    const firstPublish = await app.inject({ method: "POST", url: `/v1/sites/${site.id}/publish`, headers: { cookie } });
    expect(firstPublish.statusCode).toBe(200);
    const firstPublishId = (firstPublish.json() as { publish: { id: string } }).publish.id;

    const live1 = await app.inject({ method: "GET", url: `/v1/sites/${site.id}/live/`, headers: { cookie } });
    expect(live1.statusCode).toBe(302);
    const bundleUrl1 = live1.headers.location as string;
    const bundle1 = await app.inject({ method: "GET", url: bundleUrl1, headers: { cookie } });
    expect(bundle1.statusCode).toBe(200);
    expect(bundle1.body).toContain(heroHeading(page));

    await app.inject({
      method: "PUT",
      url: `/v1/sites/${site.id}/pages/${page.id}`,
      headers: { cookie },
      payload: {
        title: page.title,
        slug: page.slug,
        blocks: [{ ...page.blocks[0], props: { ...page.blocks[0].props, heading: "Changed after first publish" } }],
        expectedVersion: page.version,
      },
    });
    const secondPublish = await app.inject({ method: "POST", url: `/v1/sites/${site.id}/publish`, headers: { cookie } });
    expect(secondPublish.statusCode).toBe(200);

    const live2 = await app.inject({ method: "GET", url: `/v1/sites/${site.id}/live/`, headers: { cookie } });
    const bundle2 = await app.inject({ method: "GET", url: live2.headers.location as string, headers: { cookie } });
    expect(bundle2.body).toContain("Changed after first publish");

    const rollback = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/publishes/${firstPublishId}/rollback`,
      headers: { cookie },
    });
    expect(rollback.statusCode).toBe(200);

    const live3 = await app.inject({ method: "GET", url: `/v1/sites/${site.id}/live/`, headers: { cookie } });
    const bundle3 = await app.inject({ method: "GET", url: live3.headers.location as string, headers: { cookie } });
    expect(bundle3.body).toContain(heroHeading(page));
    expect(bundle3.body).not.toContain("Changed after first publish");
  }, 60_000);

  it("a site outline returns every page and block with ids, types and a one-line summary (R14)", async () => {
    const { cookie } = await seedAccountAndLogin(`outline-${newUlid()}@example.com`);
    const created = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie },
      payload: { slug: `outline-${newUlid()}`, name: "Outline" },
    });
    const { site, page } = created.json() as CreatedSite;

    const outline = await app.inject({ method: "GET", url: `/v1/sites/${site.id}/outline`, headers: { cookie } });
    expect(outline.statusCode).toBe(200);
    const body = outline.json() as OutlineBody;
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0].id).toBe(page.id);
    expect(body.pages[0].blocks[0]).toMatchObject({ id: page.blocks[0].id, type: "hero" });
    expect(typeof body.pages[0].blocks[0].summary).toBe("string");
    expect(body.pages[0].blocks[0].summary.length).toBeGreaterThan(0);
  });

  it("an API token is scoped to its own site and rejected on another", async () => {
    const { cookie } = await seedAccountAndLogin(`token-${newUlid()}@example.com`);
    const siteA = (
      await app.inject({ method: "POST", url: "/v1/sites", headers: { cookie }, payload: { slug: `tok-a-${newUlid()}`, name: "A" } })
    ).json() as CreatedSite;
    const siteB = (
      await app.inject({ method: "POST", url: "/v1/sites", headers: { cookie }, payload: { slug: `tok-b-${newUlid()}`, name: "B" } })
    ).json() as CreatedSite;

    const tokenResponse = await app.inject({
      method: "POST",
      url: `/v1/sites/${siteA.site.id}/tokens`,
      headers: { cookie },
      payload: { name: "cli" },
    });
    expect(tokenResponse.statusCode).toBe(200);
    const { token } = tokenResponse.json() as { token: string };

    const ownSite = await app.inject({
      method: "GET",
      url: `/v1/sites/${siteA.site.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ownSite.statusCode).toBe(200);

    const otherSite = await app.inject({
      method: "GET",
      url: `/v1/sites/${siteB.site.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(otherSite.statusCode).toBe(403);
  });
});

function heroHeading(page: PageDocument): string {
  return page.blocks[0].props.heading as string;
}
