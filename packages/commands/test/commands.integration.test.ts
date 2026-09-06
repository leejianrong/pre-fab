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
import { build, diff, eject, exportSite, pageWrite, preview, productCreate, publishCreate, pull, push, siteCreate, stripeConnect } from "../src/commands/index.js";
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
  await migratePool.query(
    "TRUNCATE order_items, cart_checkout_records, products, stripe_connections, publishes, blocks, pages, themes, sites, api_tokens, sessions, accounts CASCADE",
  );
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

  // KAN-1247 / ADR-0018 (part 4 addendum): confirms the brief's own "export/
  // eject already thread products through" claim actually round-trips
  // byte-identically — a product carries the same R8 guarantee pages
  // already do, verified here rather than assumed from reading the code.
  it("export -> push (no-op re-import) -> export is byte-identical for a site with a product (R8, ADR-0018)", async () => {
    const ctx = await loggedInContext(`kan1247-r8-${newUlid()}@example.com`);
    const created = await siteCreate.run(ctx, { slug: `kan1247-r8-${newUlid()}`, name: "KAN-1247 R8" });

    await productCreate.run(ctx, {
      siteId: created.site.id,
      title: "Mug",
      price: 1500,
      currency: "usd",
      fulfillmentType: "physical",
      stockCount: 5,
      status: "published",
    });

    const dir1 = await tempDir();
    await exportSite.run(ctx, { siteId: created.site.id, dir: dir1 });

    const productFiles1 = (await readdir(path.join(dir1, "products"))).sort();
    expect(productFiles1).toEqual(["mug.md"]);

    // Re-importing an unmodified export must be a true no-op — same R8
    // guarantee pages already get.
    await push.run(ctx, { dir: dir1 });

    const dir2 = await tempDir();
    await exportSite.run(ctx, { siteId: created.site.id, dir: dir2 });

    const productFiles2 = (await readdir(path.join(dir2, "products"))).sort();
    expect(productFiles2).toEqual(productFiles1);

    for (const file of productFiles1) {
      const a = await readFile(path.join(dir1, "products", file), "utf8");
      const b = await readFile(path.join(dir2, "products", file), "utf8");
      expect(b).toBe(a);
    }
  }, 30_000);

  // KAN-1247 / ADR-0018 (part 4 addendum): confirms the brief's own
  // "orders/cart_checkout_records never appear in an export, by
  // construction" claim against a REAL completed order, not just against
  // the absence of an import in export-bundle.ts/eject.ts/pull.ts/push.ts.
  it("a completed cart order never appears in a file-tree export or an eject (R20)", async () => {
    const ctx = await loggedInContext(`kan1247-r20-${newUlid()}@example.com`);
    const created = await siteCreate.run(ctx, { slug: `kan1247-r20-${newUlid()}`, name: "KAN-1247 R20" });
    const siteId = created.site.id;

    await stripeConnect.run(ctx, { siteId, authorizationCode: "fake-code" });
    const product = await productCreate.run(ctx, {
      siteId,
      title: "Sensitive Mug",
      price: 1500,
      currency: "usd",
      fulfillmentType: "physical",
      stockCount: 5,
      status: "published",
    });

    const checkoutResponse = await fetch(`${baseUrl}/v1/runtime/sites/${siteId}/cart-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ productId: product.id, quantity: 1 }] }),
    });
    expect(checkoutResponse.status).toBe(201);
    const { url } = (await checkoutResponse.json()) as { url: string };
    const sessionId = new URL(url).pathname.split("/").pop()!;
    const buyerEmail = "definitely-not-exported@example.com";

    const advanceResponse = await fetch(`${baseUrl}/v1/dev/stripe-connect/${siteId}/cart/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, buyerEmail }),
    });
    expect(advanceResponse.status).toBe(200);
    const advanced = (await advanceResponse.json()) as { status: string; cartCheckoutRecord: { id: string } };
    expect(advanced.status).toBe("applied");
    const orderMarker = advanced.cartCheckoutRecord.id;

    // Excludes `src/blocks`/`src/prefab-schema` (eject.ts copies the block
    // library's own SOURCE CODE there verbatim — CartDrawer.tsx legitimately
    // references identifiers like `cartCheckoutRecordId` as client-side
    // code, which is not site data and not what this test is checking for)
    // — restricted to the site-specific generated content files this card's
    // export-bundle.ts/eject.ts/pull.ts/push.ts actually assemble per site.
    async function walk(dir: string, excludeDirs: string[] = []): Promise<string[]> {
      const entries = await readdir(dir, { recursive: true });
      const files: string[] = [];
      for (const entry of entries) {
        if (excludeDirs.some((excluded) => entry === excluded || entry.startsWith(`${excluded}${path.sep}`))) continue;
        const full = path.join(dir, entry);
        const info = await import("node:fs/promises").then((fs) => fs.stat(full));
        if (info.isFile()) files.push(full);
      }
      return files;
    }

    async function assertNoOrderData(dir: string, excludeDirs: string[] = []): Promise<void> {
      for (const file of await walk(dir, excludeDirs)) {
        const content = await readFile(file, "utf8");
        expect(content).not.toContain(orderMarker);
        expect(content).not.toContain(buyerEmail);
        expect(content).not.toContain("oversold");
      }
    }

    const exportDir = await tempDir();
    await exportSite.run(ctx, { siteId, dir: exportDir });
    // Only the known catalogue/content file-tree shape — no order/cart file
    // of any kind (mirrors export-bundle.ts/eject.ts never importing either
    // repository's functions at all).
    const exportEntries = (await readdir(exportDir)).sort();
    expect(exportEntries).toEqual(["pages", "products", "site.json", "theme.json"]);
    await assertNoOrderData(exportDir);

    const ejectDir = await tempDir();
    await eject.run(ctx, { siteId, outDir: ejectDir });
    await assertNoOrderData(path.join(ejectDir, "src"), ["blocks", "prefab-schema"]);
    // The one file eject.ts writes catalogue/content into — confirm it
    // parses as JSON with no order-shaped keys, not just "no substring
    // match" (a stronger check than the generic walk above).
    const data = JSON.parse(await readFile(path.join(ejectDir, "src", "data.json"), "utf8"));
    expect(Object.keys(data).sort()).toEqual(["pages", "posts", "products", "runtimeApiUrl", "site", "theme", "turnstileSiteKey"]);
    expect(data.products.map((p: { title: string }) => p.title)).toContain("Sensitive Mug");
  }, 30_000);
});
