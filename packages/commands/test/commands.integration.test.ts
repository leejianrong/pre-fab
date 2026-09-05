import "dotenv/config";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@prefab/api";
import { withTenantContext, runMigrations, createAccount } from "@prefab/db";
import { newUlid } from "@prefab/schema";
import { createContext } from "../src/context.js";
import { build, diff, exportSite, pageWrite, preview, publishCreate, pull, push, siteCreate } from "../src/commands/index.js";
import type { CommandContext } from "../src/context.js";

const { Pool } = pg;

const migrateUrl = process.env.MIGRATE_DATABASE_URL_TEST;
const appUrl = process.env.DATABASE_URL_TEST;
if (!migrateUrl || !appUrl) {
  throw new Error("MIGRATE_DATABASE_URL_TEST and DATABASE_URL_TEST must be set — see .env.example");
}

const migratePool = new Pool({ connectionString: migrateUrl });
const appPool = new Pool({ connectionString: appUrl });

let app: FastifyInstance;
let baseUrl: string;
let bundleStoreDir: string;
const tempDirs: string[] = [];
const nativeFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

beforeAll(async () => {
  await runMigrations(migratePool);
  await migratePool.query("TRUNCATE publishes, blocks, pages, themes, sites, api_tokens, sessions, accounts CASCADE");
  bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-cmd-bundles-"));
  app = buildApp({ pool: appPool, bundleStoreDir });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app.close();
  await migratePool.end();
  await appPool.end();
  if (bundleStoreDir) await rm(bundleStoreDir, { recursive: true, force: true });
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pf-checkout-"));
  tempDirs.push(dir);
  return dir;
}

async function loggedInContext(email: string): Promise<CommandContext> {
  await withTenantContext(migratePool, {}, (client) => createAccount(client, { id: newUlid(), email }));
  const response = await fetch(`${baseUrl}/v1/dev/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("dev.login did not set a session cookie");
  const cookiePair = setCookie.split(";")[0]!;

  // A tiny fetch wrapper that always attaches the session cookie — mirrors
  // what a browser does automatically, since Node's fetch does not persist
  // cookies across calls on its own. Built from the true native fetch, and
  // reset in afterEach, so tests never leak a cookie into one another.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    nativeFetch(input, { ...init, headers: { ...init?.headers, cookie: cookiePair } })) as typeof fetch;

  return createContext({ apiUrl: baseUrl });
}

describe("packages/commands — the slice 1 demo script end to end", () => {
  it("create → pull → edit file → push → diff (clean) → build (offline) → preview (offline) → publish", async () => {
    const ctx = await loggedInContext(`demo-${newUlid()}@example.com`);

    const created = await siteCreate.run(ctx, { slug: `demo-${newUlid()}`, name: "Demo" });
    const dir = await tempDir();

    const pulled = await pull.run(ctx, { siteId: created.site.id, dir });
    expect(pulled.pageCount).toBe(1);

    const pageFile = path.join(dir, "pages", "home.json");
    const localPage = JSON.parse(await readFile(pageFile, "utf8"));
    localPage.blocks[0].props.heading = "Edited via the local checkout";
    await import("node:fs/promises").then((fs) => fs.writeFile(pageFile, `${JSON.stringify(localPage, null, 2)}\n`));

    const pushed = await push.run(ctx, { dir });
    expect(pushed.pushed).toContain("pages/home.json");

    const afterPush = await diff.run(ctx, { dir });
    expect(afterPush.pages.every((p) => p.diff.fields.length === 0 && p.diff.blocks.length === 0)).toBe(true);

    const built = await build.run(ctx, { dir, bundleStoreDir });
    const html = await readFile(path.join(built.bundlePath, "index.html"), "utf8");
    expect(html).toContain("Edited via the local checkout");

    const previewed = await preview.run(ctx, { dir, bundleStoreDir, screenshot: false });
    const response = await fetch(previewed.previewUrl);
    expect(await response.text()).toContain("Edited via the local checkout");
    await previewed.close();

    const published = await publishCreate.run(ctx, { siteId: created.site.id });
    const liveResponse = await fetch(`${baseUrl}${published.liveUrl}`, { redirect: "manual" });
    expect(liveResponse.status).toBe(302);
  }, 60_000);

  it("export → push (no-op re-import) → export is byte-identical (R8)", async () => {
    const ctx = await loggedInContext(`r8-${newUlid()}@example.com`);
    const created = await siteCreate.run(ctx, { slug: `r8-${newUlid()}`, name: "R8" });

    const dir1 = await tempDir();
    await exportSite.run(ctx, { siteId: created.site.id, dir: dir1 });

    // Re-importing an unmodified export must be a true no-op.
    await push.run(ctx, { dir: dir1 });

    const dir2 = await tempDir();
    await exportSite.run(ctx, { siteId: created.site.id, dir: dir2 });

    const files1 = (await readdir(path.join(dir1, "pages"))).sort();
    const files2 = (await readdir(path.join(dir2, "pages"))).sort();
    expect(files2).toEqual(files1);

    for (const file of files1) {
      const a = await readFile(path.join(dir1, "pages", file), "utf8");
      const b = await readFile(path.join(dir2, "pages", file), "utf8");
      expect(b).toBe(a);
    }
    const theme1 = await readFile(path.join(dir1, "theme.json"), "utf8");
    const theme2 = await readFile(path.join(dir2, "theme.json"), "utf8");
    expect(theme2).toBe(theme1);
  }, 30_000);

  // ADR-0014 / KAN-1129: `layoutMode` and a root block's `position` must
  // survive the exact same CLI round trip every other field does — through
  // the real API, real Postgres and the file-tree checkout, not just
  // @prefab/schema's in-memory validation.
  it('export -> push (no-op re-import) -> export is byte-identical for a "free" page with positioned blocks (R8, ADR-0014/KAN-1129)', async () => {
    const ctx = await loggedInContext(`kan1129-${newUlid()}@example.com`);
    const created = await siteCreate.run(ctx, { slug: `kan1129-${newUlid()}`, name: "KAN-1129" });
    const page = created.page;
    const heroBlock = page.blocks[0]!;

    const written = await pageWrite.run(ctx, {
      siteId: created.site.id,
      pageId: page.id,
      title: page.title,
      slug: page.slug,
      layoutMode: "free",
      blocks: [
        {
          ...heroBlock,
          position: { base: { x: 10, y: 15, w: 80, h: 30, rotate: 5, opacity: 1 } },
        },
      ],
      expectedVersion: page.version,
    });
    expect(written.layoutMode).toBe("free");

    const dir1 = await tempDir();
    await exportSite.run(ctx, { siteId: created.site.id, dir: dir1 });

    // Re-importing an unmodified export must be a true no-op, exactly like
    // the "flow" R8 test above — layoutMode "free" is not a special case.
    await push.run(ctx, { dir: dir1 });

    const dir2 = await tempDir();
    await exportSite.run(ctx, { siteId: created.site.id, dir: dir2 });

    const files1 = (await readdir(path.join(dir1, "pages"))).sort();
    const files2 = (await readdir(path.join(dir2, "pages"))).sort();
    expect(files2).toEqual(files1);

    for (const file of files1) {
      const a = await readFile(path.join(dir1, "pages", file), "utf8");
      const b = await readFile(path.join(dir2, "pages", file), "utf8");
      expect(b).toBe(a);
    }

    const exported = JSON.parse(await readFile(path.join(dir1, "pages", `${page.slug}.json`), "utf8"));
    expect(exported.layoutMode).toBe("free");
    expect(exported.blocks[0].position).toEqual({ base: { x: 10, y: 15, w: 80, h: 30, rotate: 5, opacity: 1 } });
  }, 30_000);
});
