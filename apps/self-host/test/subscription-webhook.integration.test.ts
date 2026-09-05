import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { openSelfHostDb, type SelfHostDb } from "../src/db.js";
import { RealTenantStripeProvider } from "../src/lib/tenant-stripe.js";
import type { EmailSender } from "../src/lib/email.js";

/**
 * KAN-1154 part 2 / ADR-0016 (R10) — the self-host mirror of
 * apps/api/test/subscriptions.integration.test.ts's webhook-consumption
 * coverage, against SQLite instead of Postgres, driving
 * apps/self-host/src/subscription-webhook.ts through both the dev-advance
 * route and the real signature-verified `/v1/webhooks/stripe-connect` route
 * this card added (self-host had neither before this card — see app.ts's
 * own comment on that route).
 */

let dir: string;
let bundleDir: string;
let db: SelfHostDb;
let app: FastifyInstance;
let sentEmails: Array<{ to: string; subject: string; text: string }>;
const SITE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const BLOCK_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAY";
const OWNER_EMAIL = "owner@example.com";

function seedSubscriptionBlock(): void {
  db.prepare(
    `INSERT INTO subscription_blocks (id, site_id, heading, description, button_label, price, currency, interval, trial_period_days, success_message)
     VALUES (@id, @siteId, 'Support us', '', 'Subscribe', 2500, 'usd', 'month', @trialPeriodDays, '')`,
  ).run({ id: BLOCK_ID, siteId: SITE_ID, trialPeriodDays: 0 });
}

function seedIncompleteSubscriptionRecord(stripeCheckoutSessionId: string, trialPeriodDays = 0): void {
  db.prepare(
    `INSERT INTO subscription_records (id, site_id, block_id, stripe_checkout_session_id, price, currency, interval, trial_period_days, created_at)
     VALUES (@id, @siteId, @blockId, @stripeCheckoutSessionId, 2500, 'usd', 'month', @trialPeriodDays, @createdAt)`,
  ).run({ id: `rec_${stripeCheckoutSessionId}`, siteId: SITE_ID, blockId: BLOCK_ID, stripeCheckoutSessionId, trialPeriodDays, createdAt: new Date().toISOString() });
}

function getRecord(stripeCheckoutSessionId: string): { status: string; stripe_subscription_id: string | null; cancel_at_period_end: number; canceled_at: string | null } {
  const row = db
    .prepare("SELECT status, stripe_subscription_id, cancel_at_period_end, canceled_at FROM subscription_records WHERE stripe_checkout_session_id = ?")
    .get(stripeCheckoutSessionId) as { status: string; stripe_subscription_id: string | null; cancel_at_period_end: number; canceled_at: string | null } | undefined;
  if (!row) throw new Error(`no subscription_records row for ${stripeCheckoutSessionId}`);
  return row;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pf-selfhost-subscription-webhook-"));
  bundleDir = path.join(dir, "bundle");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(path.join(bundleDir, "index.html"), "<!doctype html><title>Home</title>", "utf8");

  db = openSelfHostDb(path.join(dir, "prefab.db"));
  seedSubscriptionBlock();

  const emailSender: EmailSender = {
    async send(message) {
      sentEmails.push(message);
    },
  };
  app = buildApp({ bundleDir, db, emailSender, runtimeApiUrl: "http://localhost:8080", ownerEmail: OWNER_EMAIL });
  await app.ready();
});

beforeEach(() => {
  sentEmails = [];
});

afterAll(async () => {
  await app.close();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("apps/self-host subscription lifecycle webhook consumption (KAN-1154 part 2, ADR-0016, R10)", () => {
  it("checkout.session.completed (dev-advance) with no trial -> active, and notifies the operator", async () => {
    const stripeCheckoutSessionId = `cs_active_${Date.now()}`;
    seedIncompleteSubscriptionRecord(stripeCheckoutSessionId);
    const stripeSubscriptionId = `sub_active_${Date.now()}`;

    const response = await app.inject({
      method: "POST",
      url: "/v1/dev/stripe-connect/subscriptions/advance",
      payload: { siteId: SITE_ID, event: "checkout_completed", stripeCheckoutSessionId, stripeSubscriptionId, stripeCustomerId: `cus_${Date.now()}`, buyerEmail: "buyer@example.com" },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { status: string }).status).toBe("applied");

    const record = getRecord(stripeCheckoutSessionId);
    expect(record.status).toBe("active");
    expect(record.stripe_subscription_id).toBe(stripeSubscriptionId);
    expect(sentEmails.some((message) => message.to === OWNER_EMAIL && message.subject === "You have a new subscriber")).toBe(true);
  });

  it("checkout.session.completed with a trial configured -> trialing", async () => {
    const stripeCheckoutSessionId = `cs_trial_${Date.now()}`;
    seedIncompleteSubscriptionRecord(stripeCheckoutSessionId, 14);

    const response = await app.inject({
      method: "POST",
      url: "/v1/dev/stripe-connect/subscriptions/advance",
      payload: { siteId: SITE_ID, event: "checkout_completed", stripeCheckoutSessionId, stripeSubscriptionId: `sub_trial_${Date.now()}`, stripeCustomerId: `cus_${Date.now()}` },
    });
    expect(response.statusCode).toBe(200);
    expect(getRecord(stripeCheckoutSessionId).status).toBe("trialing");
  });

  it("invoice.payment_failed -> past_due -> customer.subscription.deleted -> canceled [terminal]", async () => {
    const stripeCheckoutSessionId = `cs_cancel_${Date.now()}`;
    seedIncompleteSubscriptionRecord(stripeCheckoutSessionId);
    const stripeSubscriptionId = `sub_cancel_${Date.now()}`;
    await app.inject({
      method: "POST",
      url: "/v1/dev/stripe-connect/subscriptions/advance",
      payload: { siteId: SITE_ID, event: "checkout_completed", stripeCheckoutSessionId, stripeSubscriptionId, stripeCustomerId: `cus_${Date.now()}` },
    });

    const failed = await app.inject({
      method: "POST",
      url: "/v1/dev/stripe-connect/subscriptions/advance",
      payload: { siteId: SITE_ID, event: "invoice_payment_failed", stripeSubscriptionId },
    });
    expect(failed.statusCode).toBe(200);
    expect(getRecord(stripeCheckoutSessionId).status).toBe("past_due");

    const deleted = await app.inject({
      method: "POST",
      url: "/v1/dev/stripe-connect/subscriptions/advance",
      payload: { siteId: SITE_ID, event: "subscription_deleted", stripeSubscriptionId },
    });
    expect(deleted.statusCode).toBe(200);
    const record = getRecord(stripeCheckoutSessionId);
    expect(record.status).toBe("canceled");
    expect(record.canceled_at).not.toBeNull();
    expect(sentEmails.some((message) => message.subject === "A subscription was canceled")).toBe(true);
  });

  it("idempotency: an exact-duplicate event id redelivered is a no-op (deduped)", async () => {
    const stripeCheckoutSessionId = `cs_dup_${Date.now()}`;
    seedIncompleteSubscriptionRecord(stripeCheckoutSessionId);
    const stripeSubscriptionId = `sub_dup_${Date.now()}`;
    const eventId = `evt_dup_${Date.now()}`;

    const payload = { siteId: SITE_ID, event: "checkout_completed", eventId, stripeCheckoutSessionId, stripeSubscriptionId, stripeCustomerId: `cus_${Date.now()}` };
    const first = await app.inject({ method: "POST", url: "/v1/dev/stripe-connect/subscriptions/advance", payload });
    expect((first.json() as { status: string }).status).toBe("applied");

    const redelivered = await app.inject({ method: "POST", url: "/v1/dev/stripe-connect/subscriptions/advance", payload });
    expect((redelivered.json() as { status: string }).status).toBe("deduped");
    expect(getRecord(stripeCheckoutSessionId).status).toBe("active");
  });

  it("idempotency: a delayed invoice.paid after customer.subscription.deleted cannot resurrect a canceled row", async () => {
    const stripeCheckoutSessionId = `cs_ooo_${Date.now()}`;
    seedIncompleteSubscriptionRecord(stripeCheckoutSessionId);
    const stripeSubscriptionId = `sub_ooo_${Date.now()}`;
    await app.inject({
      method: "POST",
      url: "/v1/dev/stripe-connect/subscriptions/advance",
      payload: { siteId: SITE_ID, event: "checkout_completed", stripeCheckoutSessionId, stripeSubscriptionId, stripeCustomerId: `cus_${Date.now()}` },
    });
    await app.inject({ method: "POST", url: "/v1/dev/stripe-connect/subscriptions/advance", payload: { siteId: SITE_ID, event: "subscription_deleted", stripeSubscriptionId } });
    expect(getRecord(stripeCheckoutSessionId).status).toBe("canceled");

    const lateInvoicePaid = await app.inject({ method: "POST", url: "/v1/dev/stripe-connect/subscriptions/advance", payload: { siteId: SITE_ID, event: "invoice_paid", stripeSubscriptionId } });
    expect(lateInvoicePaid.statusCode).toBe(404);
    expect(getRecord(stripeCheckoutSessionId).status).toBe("canceled");
  });
});

describe("apps/self-host — real, signature-verified /v1/webhooks/stripe-connect (KAN-1154 part 2)", () => {
  const STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_test_selfhost_connect";

  function signStripePayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
    return `t=${timestamp},v1=${signature}`;
  }

  it("processes a signed checkout.session.completed (subscription mode) event", async () => {
    const emailSender: EmailSender = {
      async send(message) {
        sentEmails.push(message);
      },
    };
    const realApp = buildApp({
      bundleDir,
      db,
      emailSender,
      runtimeApiUrl: "http://localhost:8080",
      ownerEmail: OWNER_EMAIL,
      tenantStripeProvider: new RealTenantStripeProvider("sk_test_unused"),
      stripeConnectWebhookSecret: STRIPE_CONNECT_WEBHOOK_SECRET,
    });
    await realApp.ready();
    try {
      const stripeCheckoutSessionId = `cs_real_${Date.now()}`;
      seedIncompleteSubscriptionRecord(stripeCheckoutSessionId);
      const stripeSubscriptionId = `sub_real_${Date.now()}`;

      const rawBody = JSON.stringify({
        id: `evt_real_${Date.now()}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: stripeCheckoutSessionId,
            mode: "subscription",
            subscription: stripeSubscriptionId,
            customer: `cus_${Date.now()}`,
            metadata: { siteId: SITE_ID },
          },
        },
      });
      const signature = signStripePayload(rawBody, STRIPE_CONNECT_WEBHOOK_SECRET);

      const response = await realApp.inject({
        method: "POST",
        url: "/v1/webhooks/stripe-connect",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        payload: rawBody,
      });
      expect(response.statusCode).toBe(200);
      expect(getRecord(stripeCheckoutSessionId).status).toBe("active");
    } finally {
      await realApp.close();
    }
  });

  it("rejects an invalid signature", async () => {
    const realApp = buildApp({
      bundleDir,
      db,
      runtimeApiUrl: "http://localhost:8080",
      tenantStripeProvider: new RealTenantStripeProvider("sk_test_unused"),
      stripeConnectWebhookSecret: STRIPE_CONNECT_WEBHOOK_SECRET,
    });
    await realApp.ready();
    try {
      const response = await realApp.inject({
        method: "POST",
        url: "/v1/webhooks/stripe-connect",
        headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
        payload: JSON.stringify({ id: "evt_bad", type: "customer.subscription.deleted", data: { object: {} } }),
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await realApp.close();
    }
  });
});
