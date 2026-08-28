import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import sharp from "sharp";
import { newUlid, type PageDocument } from "@prefab/schema";
import { POSTDETAIL_BLOCK_TYPE, postDetailDefaultProps } from "@prefab/blocks";
import { withTenantContext, runMigrations, createAccount } from "@prefab/db";
import { buildApp } from "../src/app.js";
import { FakeDomainProvider } from "../src/lib/domain-provider.js";
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
let assetStoreDir: string;
let fakeDomainProvider: FakeDomainProvider;
const TEST_PLATFORM_HOST = "prefab.test";

beforeAll(async () => {
  await runMigrations(migratePool);
  await migratePool.query(
    "TRUNCATE custom_domains, assets, publishes, blocks, pages, themes, sites, api_tokens, sessions, accounts CASCADE",
  );
  bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-api-bundles-"));
  assetStoreDir = await mkdtemp(path.join(tmpdir(), "pf-api-assets-"));
  fakeDomainProvider = new FakeDomainProvider();
  app = buildApp({ pool: appPool, bundleStoreDir, assetStoreDir, platformHost: TEST_PLATFORM_HOST, domainProvider: fakeDomainProvider });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await migratePool.end();
  await appPool.end();
  if (bundleStoreDir) await rm(bundleStoreDir, { recursive: true, force: true });
  if (assetStoreDir) await rm(assetStoreDir, { recursive: true, force: true });
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

  it("asset.upload deduplicates identical files by hash, and serves the bytes back unauthenticated", async () => {
    const { cookie } = await seedAccountAndLogin(`asset-${newUlid()}@example.com`);
    const created = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie },
      payload: { slug: `asset-${newUlid()}`, name: "Asset" },
    });
    const { site } = created.json() as CreatedSite;

    const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#4f46e5" } })
      .png()
      .toBuffer();
    const body = { filename: "hero.png", contentType: "image/png", dataBase64: png.toString("base64") };

    const first = await app.inject({ method: "POST", url: `/v1/sites/${site.id}/assets`, headers: { cookie }, payload: body });
    expect(first.statusCode).toBe(200);
    const firstAsset = first.json() as {
      id: string;
      sha256: string;
      width: number;
      height: number;
      variants: Array<{ width: number; key: string }>;
    };
    expect(firstAsset.width).toBe(2000);
    expect(firstAsset.height).toBe(1000);
    // 2000px source: every variant width narrower than the source generates (processImage skips
    // only widths >= the source), so all three of 480/960/1600 should be present here.
    expect(firstAsset.variants.map((v) => v.width).sort((a, b) => a - b)).toEqual([480, 960, 1600]);

    const second = await app.inject({ method: "POST", url: `/v1/sites/${site.id}/assets`, headers: { cookie }, payload: body });
    expect(second.statusCode).toBe(200);
    const secondAsset = second.json() as { id: string; sha256: string };
    expect(secondAsset.id).toBe(firstAsset.id);
    expect(secondAsset.sha256).toBe(firstAsset.sha256);

    const list = await app.inject({ method: "GET", url: `/v1/sites/${site.id}/assets`, headers: { cookie } });
    expect((list.json() as unknown[]).length).toBe(1);

    // Unauthenticated on purpose (published pages have no API token to send).
    const served = await app.inject({ method: "GET", url: `/v1/assets/${firstAsset.sha256}.png` });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");

    const servedVariant = await app.inject({ method: "GET", url: `/v1/assets/${firstAsset.variants[0]!.key}` });
    expect(servedVariant.statusCode).toBe(200);
    expect(servedVariant.headers["content-type"]).toContain("image/webp");
  });

  it("rejects an asset over the byte-size cap, and a non-image upload stores with no variants", async () => {
    const { cookie } = await seedAccountAndLogin(`asset-limits-${newUlid()}@example.com`);
    const created = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie },
      payload: { slug: `asset-limits-${newUlid()}`, name: "Asset limits" },
    });
    const { site } = created.json() as CreatedSite;

    const tooBig = Buffer.alloc(8 * 1024 * 1024 + 1, 1);
    const oversized = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/assets`,
      headers: { cookie },
      payload: { filename: "big.bin", contentType: "application/octet-stream", dataBase64: tooBig.toString("base64") },
    });
    expect(oversized.statusCode).toBe(400);

    const notAnImage = Buffer.from("not actually a png", "utf8");
    const uploaded = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/assets`,
      headers: { cookie },
      payload: {
        filename: "fake.png",
        contentType: "image/png",
        dataBase64: notAnImage.toString("base64"),
      },
    });
    expect(uploaded.statusCode).toBe(200);
    const asset = uploaded.json() as { width: number | null; variants: unknown[] };
    expect(asset.width).toBeNull();
    expect(asset.variants).toEqual([]);
  });
});

describe("real signup (Slice 3, built on slice 1's identity primitive)", () => {
  function extractCode(text: string): string {
    const match = /\b(\d{6})\b/.exec(text);
    if (!match) throw new Error(`no 6-digit code found in email text: ${text}`);
    return match[1]!;
  }

  it("emails a verification code, then verifying it starts a session (dev/login is untouched alongside it)", async () => {
    const email = `signup-${newUlid()}@example.com`;

    const signup = await app.inject({ method: "POST", url: "/v1/signup", payload: { email } });
    expect(signup.statusCode).toBe(200);
    expect((signup.json() as { status: string }).status).toBe("pending_verification");

    const emails = await app.inject({ method: "GET", url: `/v1/dev/emails?to=${encodeURIComponent(email)}` });
    const [message] = emails.json() as Array<{ to: string; text: string }>;
    expect(message?.to).toBe(email);
    const code = extractCode(message!.text);

    const wrongCode = await app.inject({ method: "POST", url: "/v1/signup/verify", payload: { email, code: "000000" } });
    expect(wrongCode.statusCode).toBe(401);

    const verify = await app.inject({ method: "POST", url: "/v1/signup/verify", payload: { email, code } });
    expect(verify.statusCode).toBe(200);
    const cookieHeader = verify.headers["set-cookie"];
    expect(cookieHeader).toBeDefined();

    // The minted session works exactly like dev/login's — same primitive (SLICES.md).
    const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(";")[0]!;
    const sites = await app.inject({ method: "GET", url: "/v1/sites", headers: { cookie } });
    expect(sites.statusCode).toBe(200);

    // The code is one-time use — replaying it must fail.
    const replay = await app.inject({ method: "POST", url: "/v1/signup/verify", payload: { email, code } });
    expect(replay.statusCode).toBe(401);
  });
});

describe("template fork-on-use (Slice 3, ADR-0011)", () => {
  it("lists templates and forks one with fresh ids, correctly RLS-scoped to the new owner", async () => {
    const { cookie, accountId } = await seedAccountAndLogin(`fork-${newUlid()}@example.com`);

    const list = await app.inject({ method: "GET", url: "/v1/templates", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const templates = list.json() as Array<{ id: string }>;
    expect(templates.length).toBe(8);
    const templateId = templates[0]!.id;

    const forked = await app.inject({
      method: "POST",
      url: `/v1/templates/${templateId}/use`,
      headers: { cookie },
      payload: { slug: `fork-${newUlid()}`, name: "Forked Site" },
    });
    expect(forked.statusCode).toBe(200);
    const body = forked.json() as { site: { id: string; ownerId: string }; pages: PageDocument[]; templateId: string };
    expect(body.templateId).toBe(templateId);
    expect(body.site.ownerId).toBe(accountId);
    expect(body.pages.length).toBeGreaterThan(0);
    expect(body.pages[0]!.blocks.length).toBeGreaterThan(0);
    // Every block on the new site has a fresh id — never the template's own checked-in ids.
    for (const page of body.pages) {
      expect(page.siteId).toBe(body.site.id);
      for (const block of page.blocks) expect(typeof block.id).toBe("string");
    }
  });

  it("forking the same template twice yields two independent sites (SLICES.md)", async () => {
    const { cookie } = await seedAccountAndLogin(`fork-twice-${newUlid()}@example.com`);
    const list = await app.inject({ method: "GET", url: "/v1/templates", headers: { cookie } });
    const templateId = (list.json() as Array<{ id: string }>)[0]!.id;

    const forkOnce = async () => {
      const result = await app.inject({
        method: "POST",
        url: `/v1/templates/${templateId}/use`,
        headers: { cookie },
        payload: { slug: `fork-twice-${newUlid()}`, name: "Fork" },
      });
      return result.json() as { site: { id: string }; pages: PageDocument[] };
    };

    const first = await forkOnce();
    const second = await forkOnce();

    expect(first.site.id).not.toBe(second.site.id);
    const firstBlockIds = new Set(first.pages.flatMap((p) => p.blocks.map((b) => b.id)));
    const secondBlockIds = new Set(second.pages.flatMap((p) => p.blocks.map((b) => b.id)));
    for (const id of secondBlockIds) expect(firstBlockIds.has(id)).toBe(false);

    // Editing the first fork must never be reachable from the second (independent site rows).
    const firstPageId = first.pages[0]!.id;
    const edit = await app.inject({
      method: "PUT",
      url: `/v1/sites/${second.site.id}/pages/${firstPageId}`,
      headers: { cookie },
      payload: { title: "x", slug: "home", blocks: [], expectedVersion: 0 },
    });
    expect(edit.statusCode).toBe(404);
  });
});

describe("custom domains (Slice 4, ADR-0007) — against the fake provider", () => {
  it("runs the full lifecycle: add (pending) -> verify (still pending) -> DNS propagates -> verify (active) -> repeated polls stay stable -> remove", async () => {
    const { cookie } = await seedAccountAndLogin(`domain-${newUlid()}@example.com`);
    const created = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie },
      payload: { slug: `domain-${newUlid()}`, name: "Domain Lifecycle" },
    });
    const { site } = created.json() as CreatedSite;

    const added = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/domains`,
      headers: { cookie },
      payload: { hostname: "www.example-lifecycle.test" },
    });
    expect(added.statusCode).toBe(200);
    const addedBody = added.json() as { domain: { id: string; status: string; providerHostnameId: string }; dnsInstruction: { recordType: string; name: string } };
    expect(addedBody.domain.status).toBe("pending_dns");
    expect(addedBody.dnsInstruction).toMatchObject({ recordType: "CNAME", name: "www" });
    const domainId = addedBody.domain.id;
    const providerHostnameId = addedBody.domain.providerHostnameId;

    // Not verified yet at the provider (DNS propagation is "slow") — a
    // verify call now must not false-positive to active.
    const stillPending = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/domains/${domainId}/verify`,
      headers: { cookie },
    });
    expect((stillPending.json() as { domain: { status: string } }).domain.status).toBe("pending_dns");

    // DNS propagates; the provider now reports the hostname active.
    fakeDomainProvider.advance(providerHostnameId, "active");
    const verified = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/domains/${domainId}/verify`,
      headers: { cookie },
    });
    expect((verified.json() as { domain: { status: string; verificationError: string | null } }).domain.status).toBe("active");

    // "the renewal path" (SLICES.md): a later poll (what a certificate
    // renewal check would also do) must find the same domain still active,
    // never regressing to pending or failed just because it was checked
    // again.
    const polledAgain = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/domains/${domainId}/verify`,
      headers: { cookie },
    });
    expect((polledAgain.json() as { domain: { status: string } }).domain.status).toBe("active");

    // Removing deprovisions at the provider and deletes our record.
    const removed = await app.inject({ method: "DELETE", url: `/v1/sites/${site.id}/domains/${domainId}`, headers: { cookie } });
    expect(removed.statusCode).toBe(200);
    await expect(fakeDomainProvider.getCustomHostnameStatus(providerHostnameId)).rejects.toThrow();

    const list = await app.inject({ method: "GET", url: `/v1/sites/${site.id}/domains`, headers: { cookie } });
    expect(list.json()).toEqual([]);
  });

  it("surfaces a specific, actionable error when DNS verification fails, rather than a generic failure", async () => {
    const { cookie } = await seedAccountAndLogin(`domain-fail-${newUlid()}@example.com`);
    const created = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie },
      payload: { slug: `domain-fail-${newUlid()}`, name: "Domain Failure" },
    });
    const { site } = created.json() as CreatedSite;

    const added = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/domains`,
      headers: { cookie },
      payload: { hostname: "www.example-fails.test" },
    });
    const { domain } = added.json() as { domain: { id: string; providerHostnameId: string } };

    fakeDomainProvider.advance(domain.providerHostnameId, "failed", ["CNAME record not found at www.example-fails.test"]);
    const verified = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/domains/${domain.id}/verify`,
      headers: { cookie },
    });
    const body = verified.json() as { domain: { status: string; verificationError: string | null } };
    expect(body.domain.status).toBe("failed");
    expect(body.domain.verificationError).toContain("CNAME record not found");
  });

  it("rejects an invalid hostname with a specific validation error, naming the problem (R18-style)", async () => {
    const { cookie } = await seedAccountAndLogin(`domain-invalid-${newUlid()}@example.com`);
    const created = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie },
      payload: { slug: `domain-invalid-${newUlid()}`, name: "Domain Invalid" },
    });
    const { site } = created.json() as CreatedSite;

    const badHostname = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/domains`,
      headers: { cookie },
      payload: { hostname: "*.not-valid" },
    });
    expect(badHostname.statusCode).toBe(400);
    expect((badHostname.json() as { error: { message: string } }).error.message).toMatch(/wildcard/i);

    const platformHostname = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/domains`,
      headers: { cookie },
      payload: { hostname: `${site.slug ?? "anything"}.${TEST_PLATFORM_HOST}` },
    });
    expect(platformHostname.statusCode).toBe(400);
  });

  it("rejects a domain add/verify/remove from a token scoped to a different site (RLS, ADR-0008)", async () => {
    const owner = await seedAccountAndLogin(`domain-rls-${newUlid()}@example.com`);
    const createdA = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie: owner.cookie },
      payload: { slug: `domain-rls-a-${newUlid()}`, name: "Site A" },
    });
    const siteA = (createdA.json() as CreatedSite).site;
    const createdB = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie: owner.cookie },
      payload: { slug: `domain-rls-b-${newUlid()}`, name: "Site B" },
    });
    const siteB = (createdB.json() as CreatedSite).site;

    const added = await app.inject({
      method: "POST",
      url: `/v1/sites/${siteA.id}/domains`,
      headers: { cookie: owner.cookie },
      payload: { hostname: "www.example-rls.test" },
    });
    const domainId = (added.json() as { domain: { id: string } }).domain.id;

    const crossSiteVerify = await app.inject({
      method: "POST",
      url: `/v1/sites/${siteB.id}/domains/${domainId}/verify`,
      headers: { cookie: owner.cookie },
    });
    expect(crossSiteVerify.statusCode).toBe(404);

    const crossSiteRemove = await app.inject({
      method: "DELETE",
      url: `/v1/sites/${siteB.id}/domains/${domainId}`,
      headers: { cookie: owner.cookie },
    });
    expect(crossSiteRemove.statusCode).toBe(404);

    // Untouched via the correct site.
    const list = await app.inject({ method: "GET", url: `/v1/sites/${siteA.id}/domains`, headers: { cookie: owner.cookie } });
    expect((list.json() as unknown[]).length).toBe(1);
  });
});

describe("host-based public routing (Slice 4, R1) — <slug>.<platformHost> and active custom domains", () => {
  async function publishedSite(cookie: string, slugPrefix: string) {
    const created = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie },
      payload: { slug: `${slugPrefix}-${newUlid()}`, name: "Host Routing" },
    });
    const { site } = created.json() as CreatedSite;
    const publish = await app.inject({ method: "POST", url: `/v1/sites/${site.id}/publish`, headers: { cookie } });
    expect(publish.statusCode).toBe(200);
    return site;
  }

  it("serves a site's live bundle for <slug>.<platformHost>, unauthenticated", async () => {
    const { cookie } = await seedAccountAndLogin(`host-slug-${newUlid()}@example.com`);
    const site = await publishedSite(cookie, "host-slug");

    const response = await app.inject({ method: "GET", url: "/", headers: { host: `${site.slug}.${TEST_PLATFORM_HOST}` } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(site.name);
  });

  it("serves a site for an active custom domain, and 404s once it's removed", async () => {
    const { cookie } = await seedAccountAndLogin(`host-domain-${newUlid()}@example.com`);
    const site = await publishedSite(cookie, "host-domain");

    const added = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/domains`,
      headers: { cookie },
      payload: { hostname: "www.example-hostrouting.test" },
    });
    const { domain } = added.json() as { domain: { id: string; providerHostnameId: string } };

    const beforeActive = await app.inject({ method: "GET", url: "/", headers: { host: "www.example-hostrouting.test" } });
    expect(beforeActive.statusCode).toBe(404);

    fakeDomainProvider.advance(domain.providerHostnameId, "active");
    await app.inject({ method: "POST", url: `/v1/sites/${site.id}/domains/${domain.id}/verify`, headers: { cookie } });

    const afterActive = await app.inject({ method: "GET", url: "/", headers: { host: "www.example-hostrouting.test" } });
    expect(afterActive.statusCode).toBe(200);

    await app.inject({ method: "DELETE", url: `/v1/sites/${site.id}/domains/${domain.id}`, headers: { cookie } });
    const afterRemoval = await app.inject({ method: "GET", url: "/", headers: { host: "www.example-hostrouting.test" } });
    expect(afterRemoval.statusCode).toBe(404);
  });

  it("404s for a host that matches nothing", async () => {
    const response = await app.inject({ method: "GET", url: "/", headers: { host: "nobody-has-this.example.test" } });
    expect(response.statusCode).toBe(404);
  });
});

describe("posts (Slice 5): collection CRUD, pagination, and publish visibility", () => {
  async function createdSite(cookie: string, slugPrefix: string): Promise<CreatedSite> {
    const created = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie },
      payload: { slug: `${slugPrefix}-${newUlid()}`, name: "Posts" },
    });
    expect(created.statusCode).toBe(200);
    return created.json() as CreatedSite;
  }

  it("post.create auto-generates a slug from the title, deduping against a collision", async () => {
    const { cookie } = await seedAccountAndLogin(`post-slug-${newUlid()}@example.com`);
    const { site } = await createdSite(cookie, "post-slug");

    const first = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/posts`,
      headers: { cookie },
      payload: { title: "Hello World" },
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { slug: string }).slug).toBe("hello-world");

    const second = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/posts`,
      headers: { cookie },
      payload: { title: "Hello World" },
    });
    expect((second.json() as { slug: string }).slug).toBe("hello-world-2");

    // A caller-supplied slug is respected (and still deduped).
    const explicit = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/posts`,
      headers: { cookie },
      payload: { title: "Something else", slug: "hello-world" },
    });
    expect((explicit.json() as { slug: string }).slug).toBe("hello-world-3");
  });

  it("post.write applies the same optimistic-concurrency discipline as page.write (R17)", async () => {
    const { cookie } = await seedAccountAndLogin(`post-oc-${newUlid()}@example.com`);
    const { site } = await createdSite(cookie, "post-oc");
    const created = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/posts`,
      headers: { cookie },
      payload: { title: "Draft post" },
    });
    const post = created.json() as { id: string; slug: string; date: string; version: number };

    const validWrite = await app.inject({
      method: "PUT",
      url: `/v1/sites/${site.id}/posts/${post.id}`,
      headers: { cookie },
      payload: {
        title: "Updated title",
        slug: post.slug,
        date: post.date,
        author: "Jane",
        tags: ["a", "b"],
        cover: null,
        body: "Updated body.",
        locale: "en",
        status: "published",
        expectedVersion: post.version,
      },
    });
    expect(validWrite.statusCode).toBe(200);
    expect((validWrite.json() as { version: number }).version).toBe(post.version + 1);

    const staleWrite = await app.inject({
      method: "PUT",
      url: `/v1/sites/${site.id}/posts/${post.id}`,
      headers: { cookie },
      payload: {
        title: "Stale edit",
        slug: post.slug,
        date: post.date,
        author: "",
        tags: [],
        cover: null,
        body: "",
        locale: "en",
        status: "draft",
        expectedVersion: post.version, // stale — already bumped by the write above
      },
    });
    expect(staleWrite.statusCode).toBe(409);
    const conflictBody = staleWrite.json() as { error: { details: { current: { title: string }; diff: unknown[] } } };
    expect(conflictBody.error.details.current.title).toBe("Updated title");
    expect(conflictBody.error.details.diff.length).toBeGreaterThan(0);
  });

  it("post.list paginates and reports a total independent of the page size", async () => {
    const { cookie } = await seedAccountAndLogin(`post-list-${newUlid()}@example.com`);
    const { site } = await createdSite(cookie, "post-list");
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: `/v1/sites/${site.id}/posts`,
        headers: { cookie },
        payload: { title: `Post ${i}`, date: `2024-01-0${i + 1}` },
      });
    }

    const page = await app.inject({ method: "GET", url: `/v1/sites/${site.id}/posts?limit=2&offset=0`, headers: { cookie } });
    expect(page.statusCode).toBe(200);
    const body = page.json() as { posts: unknown[]; total: number };
    expect(body.posts).toHaveLength(2);
    expect(body.total).toBe(3);
  });

  it("post.get 404s for a post that belongs to a different site", async () => {
    const { cookie } = await seedAccountAndLogin(`post-cross-${newUlid()}@example.com`);
    const { site: siteA } = await createdSite(cookie, "post-cross-a");
    const { site: siteB } = await createdSite(cookie, "post-cross-b");
    const created = await app.inject({
      method: "POST",
      url: `/v1/sites/${siteA.id}/posts`,
      headers: { cookie },
      payload: { title: "Site A post" },
    });
    const post = created.json() as { id: string };

    const crossSiteGet = await app.inject({ method: "GET", url: `/v1/sites/${siteB.id}/posts/${post.id}`, headers: { cookie } });
    expect(crossSiteGet.statusCode).toBe(404);
  });

  it("publish includes only published posts, and a draft or scheduled (future-dated) post is never reachable on the live site", async () => {
    const { cookie } = await seedAccountAndLogin(`post-visibility-${newUlid()}@example.com`);
    const { site } = await createdSite(cookie, "post-visibility");

    // A "blog" page carrying a postdetail block — the per-post route template (SLICES.md's list/detail blocks).
    const blogPage = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/pages`,
      headers: { cookie },
      payload: { slug: "blog", title: "Blog" },
    });
    const blogPageBody = blogPage.json() as PageDocument;
    await app.inject({
      method: "PUT",
      url: `/v1/sites/${site.id}/pages/${blogPageBody.id}`,
      headers: { cookie },
      payload: {
        title: "Blog",
        slug: "blog",
        blocks: [
          { id: newUlid(), type: POSTDETAIL_BLOCK_TYPE, parent: null, order: 1000, schemaVersion: 1, props: { ...postDetailDefaultProps }, responsive: {} },
        ],
        expectedVersion: blogPageBody.version,
      },
    });

    async function makePost(input: { title: string; status: "draft" | "published"; date: string }) {
      const created = await app.inject({
        method: "POST",
        url: `/v1/sites/${site.id}/posts`,
        headers: { cookie },
        payload: { title: input.title, date: input.date, status: "draft" },
      });
      const post = created.json() as { id: string; slug: string; date: string; version: number };
      await app.inject({
        method: "PUT",
        url: `/v1/sites/${site.id}/posts/${post.id}`,
        headers: { cookie },
        payload: {
          title: input.title,
          slug: post.slug,
          date: input.date,
          author: "",
          tags: [],
          cover: null,
          body: `Body of ${input.title}`,
          locale: "en",
          status: input.status,
          expectedVersion: post.version,
        },
      });
      return post.slug;
    }

    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 1);
    const futureDate = farFuture.toISOString().slice(0, 10);

    const publishedSlug = await makePost({ title: "Published post", status: "published", date: "2024-01-01" });
    await makePost({ title: "Draft post", status: "draft", date: "2024-01-01" });
    await makePost({ title: "Scheduled post", status: "published", date: futureDate });

    const publish = await app.inject({ method: "POST", url: `/v1/sites/${site.id}/publish`, headers: { cookie } });
    expect(publish.statusCode).toBe(200);

    // `/v1/sites/:id/live/*` redirects to the content-addressed bundle URL
    // (see the "publishes, serves the live bundle" test above) — follow it
    // by hand since `inject` doesn't auto-follow redirects.
    async function fetchLive(subPath: string) {
      const redirect = await app.inject({ method: "GET", url: `/v1/sites/${site.id}/live/${subPath}`, headers: { cookie } });
      if (redirect.statusCode !== 302) return redirect;
      return app.inject({ method: "GET", url: redirect.headers.location as string, headers: { cookie } });
    }

    const live = await fetchLive("");
    expect(live.statusCode).toBe(200);

    const rss = await fetchLive("rss.xml");
    expect(rss.statusCode).toBe(200);
    expect(rss.body).toContain("Published post");
    expect(rss.body).not.toContain("Draft post");
    expect(rss.body).not.toContain("Scheduled post");

    const sitemap = await fetchLive("sitemap.xml");
    expect(sitemap.statusCode).toBe(200);
    expect(sitemap.body).toContain(`blog/${publishedSlug}`);

    const publishedDetail = await fetchLive(`blog/${publishedSlug}/`);
    expect(publishedDetail.statusCode).toBe(200);
    expect(publishedDetail.body).toContain("Published post");

    const draftDetail = await fetchLive("blog/draft-post/");
    expect(draftDetail.statusCode).toBe(404);

    const scheduledDetail = await fetchLive("blog/scheduled-post/");
    expect(scheduledDetail.statusCode).toBe(404);
  });
});

function heroHeading(page: PageDocument): string {
  return page.blocks[0].props.heading as string;
}
