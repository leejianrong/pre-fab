import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { newUlid, type PageDocument } from "@prefab/schema";
import { SUBSCRIPTION_BLOCK_TYPE, subscriptionDefaultProps } from "@prefab/blocks";
import { withTenantContext, runMigrations, createAccount, getSubscriptionBlockPublic } from "@prefab/db";
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
const TEST_PLATFORM_HOST = "prefab-subscriptions.test";

beforeAll(async () => {
  await runMigrations(migratePool);
  await migratePool.query(
    "TRUNCATE subscription_records, subscription_blocks, payment_records, stripe_connections, payment_blocks, custom_domains, assets, publishes, blocks, pages, themes, sites, api_tokens, sessions, accounts CASCADE",
  );
  bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-subscriptions-bundles-"));
  assetStoreDir = await mkdtemp(path.join(tmpdir(), "pf-subscriptions-assets-"));

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

async function createPublishedSubscriptionSite(
  cookie: string,
  props: Partial<typeof subscriptionDefaultProps> = {},
): Promise<{ siteId: string; blockId: string }> {
  const created = await app.inject({
    method: "POST",
    url: "/v1/sites",
    headers: { cookie },
    payload: { slug: `subscription-site-${newUlid()}`, name: "Subscription Site" },
  });
  const { site, page } = created.json() as { site: { id: string }; page: PageDocument };
  const blockId = newUlid();

  const write = await app.inject({
    method: "PUT",
    url: `/v1/sites/${site.id}/pages/${page.id}`,
    headers: { cookie },
    payload: {
      title: page.title,
      slug: page.slug,
      blocks: [{ id: blockId, type: SUBSCRIPTION_BLOCK_TYPE, parent: null, order: 1000, schemaVersion: 1, props: { ...subscriptionDefaultProps, ...props } }],
      expectedVersion: page.version,
    },
  });
  expect(write.statusCode).toBe(200);

  const publish = await app.inject({ method: "POST", url: `/v1/sites/${site.id}/publish`, headers: { cookie } });
  expect(publish.statusCode).toBe(200);

  return { siteId: site.id, blockId };
}

interface RawSubscriptionRecordRow {
  id: string;
  site_id: string;
  block_id: string;
  stripe_checkout_session_id: string;
  stripe_subscription_id: string | null;
  price: number;
  currency: string;
  interval: string;
  trial_period_days: number;
  status: string;
}

async function getSubscriptionRecordsForSite(siteId: string, blockId: string): Promise<RawSubscriptionRecordRow[]> {
  return withTenantContext(appPool, { siteId }, async (client) => {
    const result = await client.query<RawSubscriptionRecordRow>(
      "SELECT * FROM subscription_records WHERE site_id = $1 AND block_id = $2 ORDER BY created_at DESC",
      [siteId, blockId],
    );
    return result.rows;
  });
}

describe("the runtime API — subscription checkout creation (KAN-1154, ADR-0016, part 1)", () => {
  it("creates a mode:subscription checkout session for the block's own price/currency/interval/trial, and a tampered request cannot pick a different price", async () => {
    const cookie = await seedAccountAndLogin(`subscriptions-happy-${newUlid()}@example.com`);
    const { siteId, blockId } = await createPublishedSubscriptionSite(cookie, { price: 2500, currency: "usd", interval: "month", trialPeriodDays: 14 });

    const connect = await app.inject({ method: "POST", url: `/v1/sites/${siteId}/stripe`, headers: { cookie }, payload: { authorizationCode: "fake-code" } });
    expect(connect.statusCode).toBe(200);

    // No body accepted at all — the runtime endpoint never reads a price
    // from the visitor's own request (see app.ts's own comment).
    const checkout = await app.inject({
      method: "POST",
      url: `/v1/runtime/subscription-blocks/${blockId}/checkout`,
      payload: { price: 1 },
    });
    expect(checkout.statusCode).toBe(201);
    const { url } = checkout.json() as { url: string };
    expect(url).toBeTruthy();

    const records = await getSubscriptionRecordsForSite(siteId, blockId);
    expect(records).toHaveLength(1);
    expect(records[0]?.price).toBe(2500);
    expect(records[0]?.currency).toBe("usd");
    expect(records[0]?.interval).toBe("month");
    expect(records[0]?.trial_period_days).toBe(14);
    // Part 1 (this card) only ever creates the 'incomplete' row — no
    // webhook consumer exists yet to move it further (see ADR-0016).
    expect(records[0]?.status).toBe("incomplete");
    expect(records[0]?.stripe_subscription_id).toBeNull();
  });

  it("returns not_found for an unknown block id", async () => {
    const checkout = await app.inject({ method: "POST", url: `/v1/runtime/subscription-blocks/${newUlid()}/checkout` });
    expect(checkout.statusCode).toBe(404);
  });

  it("returns not_found when the site has never connected Stripe", async () => {
    const cookie = await seedAccountAndLogin(`subscriptions-no-connection-${newUlid()}@example.com`);
    const { blockId } = await createPublishedSubscriptionSite(cookie);

    const checkout = await app.inject({ method: "POST", url: `/v1/runtime/subscription-blocks/${blockId}/checkout` });
    expect(checkout.statusCode).toBe(404);
  });
});

describe("row-level security (KAN-1154, ADR-0008)", () => {
  it("a subscription block/record for one site is invisible under another site's tenant context", async () => {
    const cookie = await seedAccountAndLogin(`subscriptions-rls-${newUlid()}@example.com`);
    const { siteId, blockId } = await createPublishedSubscriptionSite(cookie, { price: 1500 });

    const connect = await app.inject({ method: "POST", url: `/v1/sites/${siteId}/stripe`, headers: { cookie }, payload: { authorizationCode: "fake-code" } });
    expect(connect.statusCode).toBe(200);
    const checkout = await app.inject({ method: "POST", url: `/v1/runtime/subscription-blocks/${blockId}/checkout` });
    expect(checkout.statusCode).toBe(201);

    const otherSiteId = newUlid();
    const crossTenantRecords = await getSubscriptionRecordsForSite(otherSiteId, blockId);
    expect(crossTenantRecords).toHaveLength(0);

    const ownRecords = await getSubscriptionRecordsForSite(siteId, blockId);
    expect(ownRecords).toHaveLength(1);

    // subscription_blocks carries a public-read policy (the runtime must
    // resolve a blockId with no tenant context at all) — this is
    // deliberate, unlike subscription_records/stripe_connections, which
    // carry none.
    const publicRead = await withTenantContext(appPool, {}, (client) => getSubscriptionBlockPublic(client, blockId));
    expect(publicRead?.id).toBe(blockId);
  });
});
