import "dotenv/config";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { newUlid, type PageDocument } from "@prefab/schema";
import { SUBSCRIPTION_BLOCK_TYPE, subscriptionDefaultProps } from "@prefab/blocks";
import { withTenantContext, runMigrations, createAccount, getSubscriptionBlockPublic } from "@prefab/db";
import { FakeTenantStripeProvider, RealTenantStripeProvider } from "../src/lib/tenant-stripe-provider.js";
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

// ---- KAN-1154 part 2 / ADR-0016: webhook consumption — the state machine
// ADR-0016's "question 2" documents, driven end-to-end via the dev-advance
// route (the same mechanism the real, signature-verified webhook calls
// into — see subscription-webhook.ts) since no live Stripe account exists
// in this environment. ----

async function advanceSubscription(siteId: string, body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: `/v1/dev/stripe-connect/${siteId}/subscriptions/advance`, payload: body });
}

async function getSubscriptionRecord(siteId: string, blockId: string): Promise<RawSubscriptionRecordRow> {
  const records = await getSubscriptionRecordsForSite(siteId, blockId);
  expect(records).toHaveLength(1);
  return records[0]!;
}

async function ownerEmailsTo(email: string): Promise<Array<{ to: string; subject: string; text: string }>> {
  const response = await app.inject({ method: "GET", url: `/v1/dev/emails?to=${encodeURIComponent(email)}` });
  return response.json() as Array<{ to: string; subject: string; text: string }>;
}

/** Creates a site, connects Stripe, and starts a subscription checkout — the identical setup every part-1 happy-path test already does, but returning everything part 2's tests need to drive `advanceSubscription`. */
async function subscribeSite(
  email: string,
  props: Partial<typeof subscriptionDefaultProps> = {},
): Promise<{ siteId: string; blockId: string; cookie: string; stripeCheckoutSessionId: string }> {
  const cookie = await seedAccountAndLogin(email);
  const { siteId, blockId } = await createPublishedSubscriptionSite(cookie, props);
  const connect = await app.inject({ method: "POST", url: `/v1/sites/${siteId}/stripe`, headers: { cookie }, payload: { authorizationCode: "fake-code" } });
  expect(connect.statusCode).toBe(200);
  const checkout = await app.inject({ method: "POST", url: `/v1/runtime/subscription-blocks/${blockId}/checkout` });
  expect(checkout.statusCode).toBe(201);
  const record = await getSubscriptionRecord(siteId, blockId);
  return { siteId, blockId, cookie, stripeCheckoutSessionId: record.stripe_checkout_session_id };
}

describe("subscription lifecycle webhook consumption (KAN-1154 part 2, ADR-0016)", () => {
  it("checkout.session.completed with no trial configured -> active, and notifies the owner of a new subscriber", async () => {
    const ownerEmail = `subs-active-${newUlid()}@example.com`;
    const { siteId, blockId, stripeCheckoutSessionId } = await subscribeSite(ownerEmail, { price: 2000, trialPeriodDays: 0 });
    const stripeSubscriptionId = `fake_sub_${newUlid()}`;

    const advance = await advanceSubscription(siteId, {
      event: "checkout_completed",
      stripeCheckoutSessionId,
      stripeSubscriptionId,
      stripeCustomerId: `fake_cus_${newUlid()}`,
      buyerEmail: "buyer@example.com",
    });
    expect(advance.statusCode).toBe(200);
    expect((advance.json() as { status: string }).status).toBe("applied");

    const record = await getSubscriptionRecord(siteId, blockId);
    expect(record.status).toBe("active");
    expect(record.stripe_subscription_id).toBe(stripeSubscriptionId);

    const emails = await ownerEmailsTo(ownerEmail);
    expect(emails.some((message) => message.subject === "You have a new subscriber")).toBe(true);
  });

  it("checkout.session.completed with a trial configured -> trialing, not active", async () => {
    const { siteId, blockId, stripeCheckoutSessionId } = await subscribeSite(`subs-trialing-${newUlid()}@example.com`, { trialPeriodDays: 14 });

    const advance = await advanceSubscription(siteId, {
      event: "checkout_completed",
      stripeCheckoutSessionId,
      stripeSubscriptionId: `fake_sub_${newUlid()}`,
      stripeCustomerId: `fake_cus_${newUlid()}`,
    });
    expect(advance.statusCode).toBe(200);

    const record = await getSubscriptionRecord(siteId, blockId);
    expect(record.status).toBe("trialing");
  });

  it("invoice.paid after a trial -> active (trial ends, first invoice paid)", async () => {
    const { siteId, blockId, stripeCheckoutSessionId } = await subscribeSite(`subs-trial-converts-${newUlid()}@example.com`, { trialPeriodDays: 14 });
    const stripeSubscriptionId = `fake_sub_${newUlid()}`;
    await advanceSubscription(siteId, { event: "checkout_completed", stripeCheckoutSessionId, stripeSubscriptionId, stripeCustomerId: `fake_cus_${newUlid()}` });
    expect((await getSubscriptionRecord(siteId, blockId)).status).toBe("trialing");

    const advance = await advanceSubscription(siteId, { event: "invoice_paid", stripeSubscriptionId });
    expect(advance.statusCode).toBe(200);
    expect((await getSubscriptionRecord(siteId, blockId)).status).toBe("active");
  });

  it("invoice.payment_failed -> past_due, then invoice.paid recovers it -> active and notifies recovery", async () => {
    const ownerEmail = `subs-recovers-${newUlid()}@example.com`;
    const { siteId, blockId, stripeCheckoutSessionId } = await subscribeSite(ownerEmail, { trialPeriodDays: 0 });
    const stripeSubscriptionId = `fake_sub_${newUlid()}`;
    await advanceSubscription(siteId, { event: "checkout_completed", stripeCheckoutSessionId, stripeSubscriptionId, stripeCustomerId: `fake_cus_${newUlid()}` });
    expect((await getSubscriptionRecord(siteId, blockId)).status).toBe("active");

    const failed = await advanceSubscription(siteId, { event: "invoice_payment_failed", stripeSubscriptionId });
    expect(failed.statusCode).toBe(200);
    expect((await getSubscriptionRecord(siteId, blockId)).status).toBe("past_due");

    const recovered = await advanceSubscription(siteId, { event: "invoice_paid", stripeSubscriptionId });
    expect(recovered.statusCode).toBe(200);
    expect((await getSubscriptionRecord(siteId, blockId)).status).toBe("active");

    const emails = await ownerEmailsTo(ownerEmail);
    expect(emails.some((message) => message.subject === "A subscription payment recovered")).toBe(true);
    expect(emails.some((message) => message.subject === "A subscription payment failed")).toBe(true);
  });

  it("customer.subscription.updated writes Stripe's own status verbatim, plus current_period_end/cancel_at_period_end", async () => {
    const { siteId, blockId, stripeCheckoutSessionId } = await subscribeSite(`subs-updated-${newUlid()}@example.com`, { trialPeriodDays: 0 });
    const stripeSubscriptionId = `fake_sub_${newUlid()}`;
    await advanceSubscription(siteId, { event: "checkout_completed", stripeCheckoutSessionId, stripeSubscriptionId, stripeCustomerId: `fake_cus_${newUlid()}` });

    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const advance = await advanceSubscription(siteId, {
      event: "subscription_updated",
      stripeSubscriptionId,
      status: "paused",
      currentPeriodEnd: periodEnd.toISOString(),
      cancelAtPeriodEnd: true,
    });
    expect(advance.statusCode).toBe(200);

    const record = await getSubscriptionRecord(siteId, blockId);
    expect(record.status).toBe("paused");
    expect(record.cancel_at_period_end).toBe(true);
    expect(new Date(record.current_period_end as unknown as string).getTime()).toBe(periodEnd.getTime());
  });

  it("customer.subscription.deleted -> canceled [terminal], and notifies the owner", async () => {
    const ownerEmail = `subs-deleted-${newUlid()}@example.com`;
    const { siteId, blockId, stripeCheckoutSessionId } = await subscribeSite(ownerEmail, { trialPeriodDays: 0 });
    const stripeSubscriptionId = `fake_sub_${newUlid()}`;
    await advanceSubscription(siteId, { event: "checkout_completed", stripeCheckoutSessionId, stripeSubscriptionId, stripeCustomerId: `fake_cus_${newUlid()}` });

    const advance = await advanceSubscription(siteId, { event: "subscription_deleted", stripeSubscriptionId });
    expect(advance.statusCode).toBe(200);

    const record = await getSubscriptionRecord(siteId, blockId);
    expect(record.status).toBe("canceled");
    expect(record.canceled_at).not.toBeNull();

    const emails = await ownerEmailsTo(ownerEmail);
    expect(emails.some((message) => message.subject === "A subscription was canceled")).toBe(true);
  });

  it("idempotency: an exact-duplicate event id redelivered is a no-op (deduped), not a second transition", async () => {
    const { siteId, blockId, stripeCheckoutSessionId } = await subscribeSite(`subs-dup-delivery-${newUlid()}@example.com`, { trialPeriodDays: 0 });
    const stripeSubscriptionId = `fake_sub_${newUlid()}`;
    const eventId = `evt_${newUlid()}`;

    const first = await advanceSubscription(siteId, {
      event: "checkout_completed",
      eventId,
      stripeCheckoutSessionId,
      stripeSubscriptionId,
      stripeCustomerId: `fake_cus_${newUlid()}`,
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { status: string }).status).toBe("applied");

    // The exact same event.id, redelivered (Stripe retries on no-2xx) —
    // must not re-run the transition or double-notify.
    const redelivered = await advanceSubscription(siteId, {
      event: "checkout_completed",
      eventId,
      stripeCheckoutSessionId,
      stripeSubscriptionId,
      stripeCustomerId: `fake_cus_${newUlid()}`,
    });
    expect(redelivered.statusCode).toBe(200);
    expect((redelivered.json() as { status: string }).status).toBe("deduped");

    const record = await getSubscriptionRecord(siteId, blockId);
    expect(record.status).toBe("active");
  });

  it("idempotency: a delayed invoice.paid arriving AFTER customer.subscription.deleted already canceled the row cannot resurrect it", async () => {
    const { siteId, blockId, stripeCheckoutSessionId } = await subscribeSite(`subs-out-of-order-${newUlid()}@example.com`, { trialPeriodDays: 0 });
    const stripeSubscriptionId = `fake_sub_${newUlid()}`;
    await advanceSubscription(siteId, { event: "checkout_completed", stripeCheckoutSessionId, stripeSubscriptionId, stripeCustomerId: `fake_cus_${newUlid()}` });
    expect((await getSubscriptionRecord(siteId, blockId)).status).toBe("active");

    const deleted = await advanceSubscription(siteId, { event: "subscription_deleted", stripeSubscriptionId });
    expect(deleted.statusCode).toBe(200);
    expect((await getSubscriptionRecord(siteId, blockId)).status).toBe("canceled");

    // A DIFFERENT event id (not a redelivery — a genuinely distinct,
    // merely out-of-order Stripe event) arriving after the cancellation.
    // fromStatuses for invoice.paid never includes 'canceled', so this
    // must match no row.
    const lateInvoicePaid = await advanceSubscription(siteId, { event: "invoice_paid", stripeSubscriptionId });
    expect(lateInvoicePaid.statusCode).toBe(404);

    const record = await getSubscriptionRecord(siteId, blockId);
    expect(record.status).toBe("canceled");
  });

  it("subscription.list: the owner-facing read surface returns the block's own lifecycle history", async () => {
    const { siteId, blockId, cookie, stripeCheckoutSessionId } = await subscribeSite(`subs-list-${newUlid()}@example.com`, { price: 3000, trialPeriodDays: 0 });
    const stripeSubscriptionId = `fake_sub_${newUlid()}`;
    await advanceSubscription(siteId, { event: "checkout_completed", stripeCheckoutSessionId, stripeSubscriptionId, stripeCustomerId: `fake_cus_${newUlid()}`, buyerEmail: "buyer@example.com" });

    const list = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/subscription-blocks/${blockId}/subscriptions`, headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const { records, total } = list.json() as { records: Array<{ status: string; price: number; buyerEmail: string | null }>; total: number };
    expect(total).toBe(1);
    expect(records[0]?.status).toBe("active");
    expect(records[0]?.price).toBe(3000);
    expect(records[0]?.buyerEmail).toBe("buyer@example.com");
  });

  it("a stale/garbage status on customer.subscription.updated is rejected rather than corrupting the row", async () => {
    const { siteId, blockId, stripeCheckoutSessionId } = await subscribeSite(`subs-bad-status-${newUlid()}@example.com`, { trialPeriodDays: 0 });
    const stripeSubscriptionId = `fake_sub_${newUlid()}`;
    await advanceSubscription(siteId, { event: "checkout_completed", stripeCheckoutSessionId, stripeSubscriptionId, stripeCustomerId: `fake_cus_${newUlid()}` });

    const advance = await advanceSubscription(siteId, { event: "subscription_updated", stripeSubscriptionId, status: "not-a-real-status" });
    expect(advance.statusCode).toBe(400);

    expect((await getSubscriptionRecord(siteId, blockId)).status).toBe("active");
  });
});

describe("Stripe Connect webhooks (KAN-1154 part 2) — the real, signature-verified inbound path", () => {
  const STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_test_connect_secret";

  function signStripePayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
    return `t=${timestamp},v1=${signature}`;
  }

  function realWebhookApp(): FastifyInstance {
    return buildApp({
      pool: appPool,
      bundleStoreDir,
      assetStoreDir,
      platformHost: TEST_PLATFORM_HOST,
      tenantStripeProvider: new RealTenantStripeProvider("sk_test_unused"),
      stripeConnectWebhookSecret: STRIPE_CONNECT_WEBHOOK_SECRET,
    });
  }

  it("processes a signed checkout.session.completed (subscription mode) event, and is idempotent on redelivery", async () => {
    const webhookApp = realWebhookApp();
    await webhookApp.ready();
    try {
      // Seed via the FAKE-provider app above (`app`) — this test only needs
      // the real webhook ROUTE's own signature verification + dispatch, not
      // a real outbound Checkout-session-creation call (never exercised in
      // this environment — see tenant-stripe-provider.ts's module comment).
      const { siteId, blockId, stripeCheckoutSessionId } = await subscribeSite(`subs-real-webhook-${newUlid()}@example.com`, { trialPeriodDays: 0 });
      const stripeSubscriptionId = `sub_${newUlid()}`;
      const eventId = `evt_${newUlid()}`;

      const rawBody = JSON.stringify({
        id: eventId,
        type: "checkout.session.completed",
        data: {
          object: {
            id: stripeCheckoutSessionId,
            mode: "subscription",
            subscription: stripeSubscriptionId,
            customer: `cus_${newUlid()}`,
            customer_details: { email: "buyer@example.com" },
            metadata: { siteId, subscriptionRecordId: newUlid() },
          },
        },
      });
      const signature = signStripePayload(rawBody, STRIPE_CONNECT_WEBHOOK_SECRET);

      const first = await webhookApp.inject({
        method: "POST",
        url: "/v1/webhooks/stripe-connect",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        payload: rawBody,
      });
      expect(first.statusCode).toBe(200);

      const record = await getSubscriptionRecord(siteId, blockId);
      expect(record.status).toBe("active");
      expect(record.stripe_subscription_id).toBe(stripeSubscriptionId);

      // Stripe itself retries delivery on anything but a fast 2xx — the
      // same event.id arriving twice must not re-run the transition.
      const redelivered = await webhookApp.inject({
        method: "POST",
        url: "/v1/webhooks/stripe-connect",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        payload: rawBody,
      });
      expect(redelivered.statusCode).toBe(200);
      expect((await getSubscriptionRecord(siteId, blockId)).status).toBe("active");
    } finally {
      await webhookApp.close();
    }
  });

  it("rejects a webhook with an invalid signature", async () => {
    const webhookApp = realWebhookApp();
    await webhookApp.ready();
    try {
      const rawBody = JSON.stringify({ id: "evt_bad", type: "customer.subscription.deleted", data: { object: { id: "sub_x" } } });
      const response = await webhookApp.inject({
        method: "POST",
        url: "/v1/webhooks/stripe-connect",
        headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
        payload: rawBody,
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await webhookApp.close();
    }
  });
});
