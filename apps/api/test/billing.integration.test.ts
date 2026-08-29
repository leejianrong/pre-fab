import "dotenv/config";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { newUlid, type PageDocument } from "@prefab/schema";
import { withTenantContext, runMigrations, createAccount, getOrCreateSubscription, updateSubscription } from "@prefab/db";
import { buildApp } from "../src/app.js";
import { RealStripeProvider } from "../src/lib/stripe.js";
import type { FastifyInstance } from "fastify";

interface CreatedSite {
  site: { id: string; slug: string; name: string };
  page: PageDocument;
}

const { Pool } = pg;

const migrateUrl = process.env.MIGRATE_DATABASE_URL_TEST;
const appUrl = process.env.DATABASE_URL_TEST;
if (!migrateUrl || !appUrl) {
  throw new Error("MIGRATE_DATABASE_URL_TEST and DATABASE_URL_TEST must be set — see .env.example");
}

const migratePool = new Pool({ connectionString: migrateUrl });
const appPool = new Pool({ connectionString: appUrl });

const STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
const TEST_PLATFORM_HOST = "prefab-billing.test";

let app: FastifyInstance;
let bundleStoreDir: string;
let assetStoreDir: string;

beforeAll(async () => {
  await runMigrations(migratePool);
  await migratePool.query(
    "TRUNCATE stripe_webhook_events, subscriptions, site_members, custom_domains, assets, publishes, blocks, pages, themes, sites, api_tokens, sessions, accounts CASCADE",
  );
  bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-billing-bundles-"));
  assetStoreDir = await mkdtemp(path.join(tmpdir(), "pf-billing-assets-"));
  app = buildApp({
    pool: appPool,
    bundleStoreDir,
    assetStoreDir,
    platformHost: TEST_PLATFORM_HOST,
    stripeWebhookSecret: STRIPE_WEBHOOK_SECRET,
  });
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

async function upgradeToPro(accountId: string) {
  const advanced = await app.inject({ method: "POST", url: `/v1/dev/stripe/${accountId}/advance`, payload: { event: "checkout_completed" } });
  expect(advanced.statusCode).toBe(200);
}

/** Signs a payload exactly the way Stripe's real webhook sender does (RealStripeProvider.constructEvent verifies this same scheme) — proves the real, signature-verified inbound path, not just the dev-only bypass. */
function signStripePayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

describe("plan gate (Slice 8, ADR-0012) — custom domains are the first paid gate", () => {
  it("blocks domain.add on the free plan with 402 plan_required, then allows it once upgraded", async () => {
    const { cookie, accountId } = await seedAccountAndLogin(`gate-${newUlid()}@example.com`);
    const created = await app.inject({ method: "POST", url: "/v1/sites", headers: { cookie }, payload: { slug: `gate-${newUlid()}`, name: "Gate" } });
    const { site } = created.json() as CreatedSite;

    const blocked = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/domains`,
      headers: { cookie },
      payload: { hostname: "www.gate-test.example" },
    });
    expect(blocked.statusCode).toBe(402);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe("plan_required");

    await upgradeToPro(accountId);

    const allowed = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/domains`,
      headers: { cookie },
      payload: { hostname: "www.gate-test.example" },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("upgrading is idempotent — a second plan.upgrade call on an already-pro account needs no new checkout", async () => {
    const { cookie, accountId } = await seedAccountAndLogin(`gate-idem-${newUlid()}@example.com`);
    await upgradeToPro(accountId);

    const second = await app.inject({ method: "POST", url: "/v1/account/plan", headers: { cookie }, payload: { plan: "pro" } });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { checkout: unknown }).checkout).toBeNull();
  });
});

describe("dunning: payment failure moves to a grace state, never an immediate takedown", () => {
  it("past_due keeps full pro access; a successful payment reactivates", async () => {
    const { cookie, accountId } = await seedAccountAndLogin(`dunning-${newUlid()}@example.com`);
    await upgradeToPro(accountId);
    const created = await app.inject({ method: "POST", url: "/v1/sites", headers: { cookie }, payload: { slug: `dunning-${newUlid()}`, name: "Dunning" } });
    const { site } = created.json() as CreatedSite;

    const failed = await app.inject({ method: "POST", url: `/v1/dev/stripe/${accountId}/advance`, payload: { event: "payment_failed" } });
    expect(failed.statusCode).toBe(200);
    const failedBody = failed.json() as { subscription: { status: string; gracePeriodEndsAt: string | null } };
    expect(failedBody.subscription.status).toBe("past_due");
    expect(failedBody.subscription.gracePeriodEndsAt).not.toBeNull();

    // Grace state: still allowed to add a domain, never taken down immediately.
    const stillAllowed = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/domains`,
      headers: { cookie },
      payload: { hostname: "www.dunning-test.example" },
    });
    expect(stillAllowed.statusCode).toBe(200);

    const recovered = await app.inject({ method: "POST", url: `/v1/dev/stripe/${accountId}/advance`, payload: { event: "payment_succeeded" } });
    const recoveredBody = recovered.json() as { subscription: { status: string; gracePeriodEndsAt: string | null } };
    expect(recoveredBody.subscription.status).toBe("active");
    expect(recoveredBody.subscription.gracePeriodEndsAt).toBeNull();
  });
});

describe("cancellation (Slice 8, R7) — 30-day retention, export never gated", () => {
  it("plan.cancel starts the retention window, blocks new custom domains, and export keeps working", async () => {
    const { cookie, accountId } = await seedAccountAndLogin(`cancel-${newUlid()}@example.com`);
    await upgradeToPro(accountId);
    const created = await app.inject({ method: "POST", url: "/v1/sites", headers: { cookie }, payload: { slug: `cancel-${newUlid()}`, name: "Cancel" } });
    const { site } = created.json() as CreatedSite;

    const canceled = await app.inject({ method: "POST", url: "/v1/account/plan/cancel", headers: { cookie } });
    expect(canceled.statusCode).toBe(200);
    const canceledBody = canceled.json() as { status: string; retentionEndsAt: string | null };
    expect(canceledBody.status).toBe("canceled");
    expect(canceledBody.retentionEndsAt).not.toBeNull();
    expect(new Date(canceledBody.retentionEndsAt!).getTime()).toBeGreaterThan(Date.now());

    // The new-domain gate is closed the instant it's canceled — no grace for a new purchase.
    const blocked = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/domains`,
      headers: { cookie },
      payload: { hostname: "www.cancel-test.example" },
    });
    expect(blocked.statusCode).toBe(402);

    // R7: export is never gated, on any tier, including a cancelled one inside its retention window.
    const site404check = await app.inject({ method: "GET", url: `/v1/sites/${site.id}`, headers: { cookie } });
    expect(site404check.statusCode).toBe(200);
    const pages = await app.inject({ method: "GET", url: `/v1/sites/${site.id}/pages`, headers: { cookie } });
    expect(pages.statusCode).toBe(200);
    const theme = await app.inject({ method: "GET", url: `/v1/sites/${site.id}/theme`, headers: { cookie } });
    expect(theme.statusCode).toBe(200);
  });

  it("stops serving the live site only once the 30-day retention window has fully elapsed — never sooner", async () => {
    const { cookie, accountId } = await seedAccountAndLogin(`retention-${newUlid()}@example.com`);
    await upgradeToPro(accountId);
    const created = await app.inject({ method: "POST", url: "/v1/sites", headers: { cookie }, payload: { slug: `retention-${newUlid()}`, name: "Retention" } });
    const { site } = created.json() as CreatedSite;
    const published = await app.inject({ method: "POST", url: `/v1/sites/${site.id}/publish`, headers: { cookie } });
    expect(published.statusCode).toBe(200);

    const liveBefore = await app.inject({ method: "GET", url: "/", headers: { host: `${site.slug}.${TEST_PLATFORM_HOST}` } });
    expect(liveBefore.statusCode).toBe(200);

    // Cancel, then directly backdate retentionEndsAt into the past — the
    // only way to test "fully elapsed" without waiting 30 real days.
    await app.inject({ method: "POST", url: "/v1/account/plan/cancel", headers: { cookie } });
    await withTenantContext(appPool, {}, (client) =>
      updateSubscription(client, accountId, { retentionEndsAt: new Date(Date.now() - 1000) }),
    );

    const liveAfter = await app.inject({ method: "GET", url: "/", headers: { host: `${site.slug}.${TEST_PLATFORM_HOST}` } });
    expect(liveAfter.statusCode).toBe(404);

    // Still true even once retention has fully elapsed and the site has
    // stopped serving (R7 — export is never gated, ever, on any tier).
    const stillReadable = await app.inject({ method: "GET", url: `/v1/sites/${site.id}`, headers: { cookie } });
    expect(stillReadable.statusCode).toBe(200);
  });
});

describe("member roles (Slice 8) — owner/editor/viewer, enforced on every mutation's authorization check", () => {
  it("an invited editor can write content but not manage domains, tokens or members; a viewer can read but not write", async () => {
    const ownerEmail = `role-owner-${newUlid()}@example.com`;
    const editorEmail = `role-editor-${newUlid()}@example.com`;
    const viewerEmail = `role-viewer-${newUlid()}@example.com`;
    const owner = await seedAccountAndLogin(ownerEmail);
    const editorAccount = await seedAccountAndLogin(editorEmail);
    const viewerAccount = await seedAccountAndLogin(viewerEmail);
    await upgradeToPro(owner.accountId);

    const created = await app.inject({
      method: "POST",
      url: "/v1/sites",
      headers: { cookie: owner.cookie },
      payload: { slug: `roles-${newUlid()}`, name: "Roles" },
    });
    const { site, page } = created.json() as CreatedSite;

    // Inviting an email with no matching account is rejected — nothing
    // to relate this site to.
    const invitedUnknown = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/members`,
      headers: { cookie: owner.cookie },
      payload: { email: `no-such-account-${newUlid()}@example.com`, role: "editor" },
    });
    expect(invitedUnknown.statusCode).toBe(404);

    const editorMember = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/members`,
      headers: { cookie: owner.cookie },
      payload: { email: editorEmail, role: "editor" },
    });
    expect(editorMember.statusCode).toBe(200);
    expect((editorMember.json() as { role: string }).role).toBe("editor");

    const viewerMember = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/members`,
      headers: { cookie: owner.cookie },
      payload: { email: viewerEmail, role: "viewer" },
    });
    expect(viewerMember.statusCode).toBe(200);
    expect((viewerMember.json() as { role: string }).role).toBe("viewer");

    // A second invite of the same account is rejected as a duplicate.
    const duplicateInvite = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/members`,
      headers: { cookie: owner.cookie },
      payload: { email: editorEmail, role: "viewer" },
    });
    expect(duplicateInvite.statusCode).toBe(409);

    // Member list shows all three.
    const list = await app.inject({ method: "GET", url: `/v1/sites/${site.id}/members`, headers: { cookie: owner.cookie } });
    expect((list.json() as Array<{ role: string }>).map((m) => m.role).sort()).toEqual(["editor", "owner", "viewer"]);

    // Editor: can write a page, cannot add a domain, cannot mint a token, cannot invite.
    const editorWrite = await app.inject({
      method: "PUT",
      url: `/v1/sites/${site.id}/pages/${page.id}`,
      headers: { cookie: editorAccount.cookie },
      payload: { title: "Edited by editor", slug: page.slug, blocks: page.blocks, expectedVersion: page.version },
    });
    expect(editorWrite.statusCode).toBe(200);

    const editorDomainAdd = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/domains`,
      headers: { cookie: editorAccount.cookie },
      payload: { hostname: "www.role-editor-test.example" },
    });
    expect(editorDomainAdd.statusCode).toBe(403);

    const editorTokenCreate = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/tokens`,
      headers: { cookie: editorAccount.cookie },
      payload: { name: "editor's token" },
    });
    expect(editorTokenCreate.statusCode).toBe(403);

    const editorInvite = await app.inject({
      method: "POST",
      url: `/v1/sites/${site.id}/members`,
      headers: { cookie: editorAccount.cookie },
      payload: { email: "nobody@example.com", role: "viewer" },
    });
    expect(editorInvite.statusCode).toBe(403);

    // Viewer: can read, cannot write.
    const viewerRead = await app.inject({ method: "GET", url: `/v1/sites/${site.id}/pages/${page.id}`, headers: { cookie: viewerAccount.cookie } });
    expect(viewerRead.statusCode).toBe(200);

    const viewerWrite = await app.inject({
      method: "PUT",
      url: `/v1/sites/${site.id}/pages/${page.id}`,
      headers: { cookie: viewerAccount.cookie },
      payload: { title: "Edited by viewer — should be rejected", slug: page.slug, blocks: page.blocks, expectedVersion: 1 },
    });
    expect(viewerWrite.statusCode).toBe(403);

    // An account with no relationship to the site at all gets the same 403 a nonexistent site would.
    const outsider = await seedAccountAndLogin(`role-outsider-${newUlid()}@example.com`);
    const outsiderRead = await app.inject({ method: "GET", url: `/v1/sites/${site.id}`, headers: { cookie: outsider.cookie } });
    expect(outsiderRead.statusCode).toBe(403);

    // The owner's own role cannot be changed or removed via the member routes.
    const demoteOwner = await app.inject({
      method: "PUT",
      url: `/v1/sites/${site.id}/members/${owner.accountId}`,
      headers: { cookie: owner.cookie },
      payload: { role: "viewer" },
    });
    expect(demoteOwner.statusCode).toBe(403);

    const removeOwner = await app.inject({ method: "DELETE", url: `/v1/sites/${site.id}/members/${owner.accountId}`, headers: { cookie: owner.cookie } });
    expect(removeOwner.statusCode).toBe(403);

    // Promote the viewer to editor, then remove the original editor entirely.
    const promote = await app.inject({
      method: "PUT",
      url: `/v1/sites/${site.id}/members/${viewerAccount.accountId}`,
      headers: { cookie: owner.cookie },
      payload: { role: "editor" },
    });
    expect(promote.statusCode).toBe(200);
    expect((promote.json() as { role: string }).role).toBe("editor");

    const remove = await app.inject({ method: "DELETE", url: `/v1/sites/${site.id}/members/${editorAccount.accountId}`, headers: { cookie: owner.cookie } });
    expect(remove.statusCode).toBe(200);

    // The removed editor loses access entirely — even to read.
    const removedRead = await app.inject({ method: "GET", url: `/v1/sites/${site.id}`, headers: { cookie: editorAccount.cookie } });
    expect(removedRead.statusCode).toBe(403);
  });
});

describe("Stripe webhooks (Slice 8) — real signature-verified inbound path", () => {
  function realStripeApp(): FastifyInstance {
    return buildApp({
      pool: appPool,
      bundleStoreDir,
      assetStoreDir,
      platformHost: TEST_PLATFORM_HOST,
      stripeProvider: new RealStripeProvider("sk_test_unused", "https://example.test/success", "https://example.test/cancel"),
      stripeWebhookSecret: STRIPE_WEBHOOK_SECRET,
    });
  }

  it("rejects a webhook with an invalid signature", async () => {
    const webhookApp = realStripeApp();
    await webhookApp.ready();
    try {
      const rawBody = JSON.stringify({ id: "evt_bad", type: "invoice.payment_failed", data: { object: { customer: "cus_x" } } });
      const response = await webhookApp.inject({
        method: "POST",
        url: "/v1/webhooks/stripe",
        headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
        payload: rawBody,
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await webhookApp.close();
    }
  });

  it("processes a correctly-signed invoice.payment_failed event and is idempotent on redelivery", async () => {
    const webhookApp = realStripeApp();
    await webhookApp.ready();
    try {
      const { accountId } = await seedAccountAndLogin(`webhook-${newUlid()}@example.com`);
      const stripeCustomerId = `cus_webhook_${newUlid()}`;
      await withTenantContext(appPool, {}, (client) => getOrCreateSubscription(client, newUlid(), accountId));
      await withTenantContext(appPool, {}, (client) =>
        updateSubscription(client, accountId, { plan: "pro", status: "active", stripeCustomerId, stripeSubscriptionId: `sub_${newUlid()}` }),
      );

      const eventId = `evt_${newUlid()}`;
      const rawBody = JSON.stringify({ id: eventId, type: "invoice.payment_failed", data: { object: { customer: stripeCustomerId } } });
      const signature = signStripePayload(rawBody, STRIPE_WEBHOOK_SECRET);

      const first = await webhookApp.inject({
        method: "POST",
        url: "/v1/webhooks/stripe",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        payload: rawBody,
      });
      expect(first.statusCode).toBe(200);
      expect((first.json() as { deduped?: boolean }).deduped).toBeUndefined();

      const afterFirst = await withTenantContext(appPool, {}, (client) => getOrCreateSubscription(client, newUlid(), accountId));
      expect(afterFirst.status).toBe("past_due");
      expect(afterFirst.gracePeriodEndsAt).not.toBeNull();

      // Stripe itself retries delivery — the same event.id arriving twice must not double-apply.
      const redelivered = await webhookApp.inject({
        method: "POST",
        url: "/v1/webhooks/stripe",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        payload: rawBody,
      });
      expect(redelivered.statusCode).toBe(200);
      expect((redelivered.json() as { deduped?: boolean }).deduped).toBe(true);
    } finally {
      await webhookApp.close();
    }
  });

  it("processes a checkout.session.completed event, resolving the account via client_reference_id", async () => {
    const webhookApp = realStripeApp();
    await webhookApp.ready();
    try {
      const { accountId } = await seedAccountAndLogin(`webhook-checkout-${newUlid()}@example.com`);
      const stripeCustomerId = `cus_checkout_${newUlid()}`;
      const stripeSubscriptionId = `sub_checkout_${newUlid()}`;
      const rawBody = JSON.stringify({
        id: `evt_${newUlid()}`,
        type: "checkout.session.completed",
        data: { object: { customer: stripeCustomerId, subscription: stripeSubscriptionId, client_reference_id: accountId } },
      });
      const signature = signStripePayload(rawBody, STRIPE_WEBHOOK_SECRET);

      const response = await webhookApp.inject({
        method: "POST",
        url: "/v1/webhooks/stripe",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        payload: rawBody,
      });
      expect(response.statusCode).toBe(200);

      const subscription = await withTenantContext(appPool, {}, (client) => getOrCreateSubscription(client, newUlid(), accountId));
      expect(subscription.plan).toBe("pro");
      expect(subscription.status).toBe("active");
      expect(subscription.stripeCustomerId).toBe(stripeCustomerId);
    } finally {
      await webhookApp.close();
    }
  });
});
