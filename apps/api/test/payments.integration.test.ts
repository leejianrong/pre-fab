import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { newUlid, type PageDocument } from "@prefab/schema";
import { PAYMENT_BLOCK_TYPE, paymentDefaultProps } from "@prefab/blocks";
import { withTenantContext, runMigrations, createAccount, getPaymentBlockPublic, listPaymentRecordsForSite } from "@prefab/db";
import { FakeTenantStripeProvider } from "../src/lib/tenant-stripe-provider.js";
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

let bundleStoreDir: string;
let assetStoreDir: string;
let app: FastifyInstance;
let tenantStripeProvider: FakeTenantStripeProvider;
const TEST_PLATFORM_HOST = "prefab-payments.test";

beforeAll(async () => {
  await runMigrations(migratePool);
  await migratePool.query(
    "TRUNCATE payment_records, stripe_connections, payment_blocks, custom_domains, assets, publishes, blocks, pages, themes, sites, api_tokens, sessions, accounts CASCADE",
  );
  bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-payments-bundles-"));
  assetStoreDir = await mkdtemp(path.join(tmpdir(), "pf-payments-assets-"));

  tenantStripeProvider = new FakeTenantStripeProvider();
  app = buildApp({ pool: appPool, bundleStoreDir, assetStoreDir, platformHost: TEST_PLATFORM_HOST, tenantStripeProvider });
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
  const cookieHeader = login.headers["set-cookie"];
  const cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  return cookie!.split(";")[0]!;
}

async function createPublishedPaymentSite(cookie: string, props: Partial<typeof paymentDefaultProps> = {}): Promise<{ siteId: string; blockId: string }> {
  const created = await app.inject({ method: "POST", url: "/v1/sites", headers: { cookie }, payload: { slug: `payment-site-${newUlid()}`, name: "Payment Site" } });
  const { site, page } = created.json() as { site: { id: string }; page: PageDocument };
  const blockId = newUlid();

  const write = await app.inject({
    method: "PUT",
    url: `/v1/sites/${site.id}/pages/${page.id}`,
    headers: { cookie },
    payload: {
      title: page.title,
      slug: page.slug,
      blocks: [{ id: blockId, type: PAYMENT_BLOCK_TYPE, parent: null, order: 1000, schemaVersion: 1, props: { ...paymentDefaultProps, ...props } }],
      expectedVersion: page.version,
    },
  });
  expect(write.statusCode).toBe(200);

  const publish = await app.inject({ method: "POST", url: `/v1/sites/${site.id}/publish`, headers: { cookie } });
  expect(publish.statusCode).toBe(200);

  return { siteId: site.id, blockId };
}

function sessionIdFromUrl(url: string): string {
  return new URL(url).pathname.split("/").pop()!;
}

describe("stripe.connect / stripe.disconnect / stripe.status (Slice 10 / KAN-1137, ADR-0005)", () => {
  it("connects, never returns the access token, and disconnects", async () => {
    const cookie = await seedAccountAndLogin(`stripe-connect-${newUlid()}@example.com`);
    const { siteId } = await createPublishedPaymentSite(cookie);

    const connect = await app.inject({ method: "POST", url: `/v1/sites/${siteId}/stripe`, headers: { cookie }, payload: { authorizationCode: "fake-code" } });
    expect(connect.statusCode).toBe(200);
    const connectBody = connect.json() as Record<string, unknown>;
    expect(connectBody.stripeAccountId).toBeTruthy();
    expect(connectBody.status).toBe("connected");
    expect(connectBody.accessToken).toBeUndefined();

    const status = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/stripe`, headers: { cookie } });
    expect(status.statusCode).toBe(200);
    const statusBody = status.json() as Record<string, unknown>;
    expect(statusBody.stripeAccountId).toBe(connectBody.stripeAccountId);
    expect(statusBody.accessToken).toBeUndefined();

    const disconnect = await app.inject({ method: "DELETE", url: `/v1/sites/${siteId}/stripe`, headers: { cookie } });
    expect(disconnect.statusCode).toBe(200);
    const afterDisconnect = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/stripe`, headers: { cookie } });
    expect(afterDisconnect.json()).toBeNull();
  });

  it("a non-owner (editor) cannot connect Stripe", async () => {
    const ownerCookie = await seedAccountAndLogin(`stripe-owner-${newUlid()}@example.com`);
    const { siteId } = await createPublishedPaymentSite(ownerCookie);

    // member.invite requires the invitee's account to already exist, so
    // this account is created directly rather than through
    // seedAccountAndLogin (which would create it a second time).
    const editorEmail = `stripe-editor-${newUlid()}@example.com`;
    await withTenantContext(migratePool, {}, (client) => createAccount(client, { id: newUlid(), email: editorEmail }));
    const invite = await app.inject({ method: "POST", url: `/v1/sites/${siteId}/members`, headers: { cookie: ownerCookie }, payload: { email: editorEmail, role: "editor" } });
    expect(invite.statusCode).toBe(200);
    const editorLogin = await app.inject({ method: "POST", url: "/v1/dev/login", payload: { email: editorEmail } });
    const editorCookieHeader = editorLogin.headers["set-cookie"];
    const editorCookie = (Array.isArray(editorCookieHeader) ? editorCookieHeader[0] : editorCookieHeader)!.split(";")[0]!;

    const connect = await app.inject({ method: "POST", url: `/v1/sites/${siteId}/stripe`, headers: { cookie: editorCookie }, payload: { authorizationCode: "fake-code" } });
    expect(connect.statusCode).toBe(403);
  });
});

describe("the runtime API — payment checkout (Slice 10 / KAN-1137, ADR-0005)", () => {
  it("creates a checkout session for the block's own amount/currency, and a tampered request cannot pick a different amount", async () => {
    const cookie = await seedAccountAndLogin(`payments-happy-${newUlid()}@example.com`);
    const { siteId, blockId } = await createPublishedPaymentSite(cookie, { amount: 2500, currency: "usd" });

    const connect = await app.inject({ method: "POST", url: `/v1/sites/${siteId}/stripe`, headers: { cookie }, payload: { authorizationCode: "fake-code" } });
    expect(connect.statusCode).toBe(200);

    // No body accepted at all — the runtime endpoint never reads an amount
    // from the visitor's own request (see app.ts's own comment).
    const checkout = await app.inject({
      method: "POST",
      url: `/v1/runtime/payment-blocks/${blockId}/checkout`,
      payload: { amount: 1 },
    });
    expect(checkout.statusCode).toBe(201);
    const { url } = checkout.json() as { url: string };
    expect(url).toBeTruthy();

    const sessionId = sessionIdFromUrl(url);

    const advance = await app.inject({
      method: "POST",
      url: `/v1/dev/stripe-connect/${siteId}/advance`,
      payload: { sessionId, buyerEmail: "buyer@example.com" },
    });
    expect(advance.statusCode).toBe(200);
    const advanceBody = advance.json() as { record: { status: string; amount: number; currency: string; buyerEmail: string } };
    expect(advanceBody.record.status).toBe("completed");
    expect(advanceBody.record.amount).toBe(2500);
    expect(advanceBody.record.currency).toBe("usd");
    expect(advanceBody.record.buyerEmail).toBe("buyer@example.com");

    const list = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/payment-blocks/${blockId}/payments`, headers: { cookie } });
    const listBody = list.json() as { records: Array<{ status: string; stripeSessionId: string }>; total: number };
    expect(listBody.total).toBe(1);
    expect(listBody.records[0]?.status).toBe("completed");
    expect(listBody.records[0]?.stripeSessionId).toBe(sessionId);
  });

  it("returns not_found for an unknown block id", async () => {
    const checkout = await app.inject({ method: "POST", url: `/v1/runtime/payment-blocks/${newUlid()}/checkout` });
    expect(checkout.statusCode).toBe(404);
  });

  it("returns not_found when the site has never connected Stripe", async () => {
    const cookie = await seedAccountAndLogin(`payments-no-connection-${newUlid()}@example.com`);
    const { blockId } = await createPublishedPaymentSite(cookie);

    const checkout = await app.inject({ method: "POST", url: `/v1/runtime/payment-blocks/${blockId}/checkout` });
    expect(checkout.statusCode).toBe(404);
  });
});

describe("row-level security (Slice 10 / KAN-1137, ADR-0008)", () => {
  it("a payment block/record for one site is invisible under another site's tenant context", async () => {
    const cookie = await seedAccountAndLogin(`payments-rls-${newUlid()}@example.com`);
    const { siteId, blockId } = await createPublishedPaymentSite(cookie, { amount: 1500 });

    const connect = await app.inject({ method: "POST", url: `/v1/sites/${siteId}/stripe`, headers: { cookie }, payload: { authorizationCode: "fake-code" } });
    expect(connect.statusCode).toBe(200);
    const checkout = await app.inject({ method: "POST", url: `/v1/runtime/payment-blocks/${blockId}/checkout` });
    expect(checkout.statusCode).toBe(201);

    const otherSiteId = newUlid();
    const crossTenantRecords = await withTenantContext(appPool, { siteId: otherSiteId }, (client) => listPaymentRecordsForSite(client, otherSiteId, blockId));
    expect(crossTenantRecords.total).toBe(0);

    const ownRecords = await withTenantContext(appPool, { siteId }, (client) => listPaymentRecordsForSite(client, siteId, blockId));
    expect(ownRecords.total).toBe(1);

    // payment_blocks carries a public-read policy (the runtime must resolve
    // a blockId with no tenant context at all) — this is deliberate, unlike
    // payment_records/stripe_connections, which carry none.
    const publicRead = await withTenantContext(appPool, {}, (client) => getPaymentBlockPublic(client, blockId));
    expect(publicRead?.id).toBe(blockId);
  });
});
