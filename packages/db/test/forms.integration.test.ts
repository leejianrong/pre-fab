import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newUlid } from "@prefab/schema";
import { createPool, runMigrations, withTenantContext } from "../src/index.js";
import { createAccount, createSite } from "../src/repositories/index.js";
import { getForm, getFormPublic, getFormSettings, upsertFormSettings, upsertPublishedForm } from "../src/repositories/forms.js";
import { createSubmission, deleteSubmission, getSubmission, listSubmissions } from "../src/repositories/submissions.js";
import { createWebhookDelivery, listDueWebhookDeliveries, recordWebhookAttempt } from "../src/repositories/webhook-deliveries.js";

const migrateUrl = process.env.MIGRATE_DATABASE_URL_TEST;
const appUrl = process.env.DATABASE_URL_TEST;

if (!migrateUrl || !appUrl) {
  throw new Error("MIGRATE_DATABASE_URL_TEST and DATABASE_URL_TEST must be set — see .env.example and scripts/db-up.sh");
}

const migratePool = createPool(migrateUrl);
const appPool = createPool(appUrl);

beforeAll(async () => {
  await runMigrations(migratePool);
});

afterAll(async () => {
  await migratePool.end();
  await appPool.end();
});

async function makeSite(prefix: string) {
  const owner = await withTenantContext(migratePool, {}, (client) =>
    createAccount(client, { id: newUlid(), email: `${prefix}-${newUlid()}@example.com` }),
  );
  const site = await withTenantContext(appPool, { accountId: owner.id }, (client) =>
    createSite(client, { id: newUlid(), slug: `${prefix}-${newUlid()}`, name: prefix, ownerId: owner.id }),
  );
  return { owner, site };
}

describe("forms manifest (Slice 6)", () => {
  it("upsertPublishedForm never touches notify/webhook settings on a republish", async () => {
    const { site } = await makeSite("forms-manifest");
    const formId = newUlid();

    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertPublishedForm(client, {
        id: formId,
        siteId: site.id,
        heading: "Contact us",
        fields: [{ type: "email", label: "Email", name: "email", required: true }],
        submitLabel: "Send",
        turnstileEnabled: false,
      }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertFormSettings(client, {
        formId,
        siteId: site.id,
        notifyEmail: "owner@example.com",
        webhookUrl: "https://example.com/hook",
        webhookSecret: "shh",
      }),
    );

    // Republish with a changed heading — settings must survive untouched.
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertPublishedForm(client, {
        id: formId,
        siteId: site.id,
        heading: "Get in touch",
        fields: [{ type: "email", label: "Email", name: "email", required: true }],
        submitLabel: "Send",
        turnstileEnabled: false,
      }),
    );

    const manifest = await withTenantContext(appPool, { siteId: site.id }, (client) => getForm(client, site.id, formId));
    expect(manifest?.heading).toBe("Get in touch");

    const settings = await withTenantContext(appPool, { siteId: site.id }, (client) => getFormSettings(client, site.id, formId));
    expect(settings?.notifyEmail).toBe("owner@example.com");
    expect(settings?.webhookUrl).toBe("https://example.com/hook");
  });

  it("getFormPublic resolves a form with no tenant context at all (the runtime submit path)", async () => {
    const { site } = await makeSite("forms-public");
    const formId = newUlid();
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertPublishedForm(client, {
        id: formId,
        siteId: site.id,
        heading: "Contact",
        fields: [],
        submitLabel: "Submit",
        turnstileEnabled: false,
      }),
    );

    const found = await withTenantContext(appPool, {}, (client) => getFormPublic(client, formId));
    expect(found?.id).toBe(formId);
    expect(found?.siteId).toBe(site.id);

    const missing = await withTenantContext(appPool, {}, (client) => getFormPublic(client, newUlid()));
    expect(missing).toBeNull();
  });

  it("form_settings carries no public read policy — a context-free read never returns a secret", async () => {
    const { site } = await makeSite("forms-secret");
    const formId = newUlid();
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertFormSettings(client, {
        formId,
        siteId: site.id,
        notifyEmail: "owner@example.com",
        webhookUrl: "https://example.com/hook",
        webhookSecret: "top-secret",
      }),
    );

    const contextFree = await withTenantContext(appPool, {}, (client) => getFormSettings(client, site.id, formId));
    expect(contextFree).toBeNull();

    const crossTenant = await withTenantContext(appPool, { siteId: newUlid() }, (client) => getFormSettings(client, site.id, formId));
    expect(crossTenant).toBeNull();
  });
});

describe("submissions under RLS (Slice 6, R20)", () => {
  it("a submission created for one site is invisible under another site's context", async () => {
    const { site: siteA } = await makeSite("submissions-a");
    const { site: siteB } = await makeSite("submissions-b");
    const formId = newUlid();
    await withTenantContext(appPool, { siteId: siteA.id }, (client) =>
      upsertPublishedForm(client, { id: formId, siteId: siteA.id, heading: "", fields: [], submitLabel: "Submit", turnstileEnabled: false }),
    );

    const submission = await withTenantContext(appPool, { siteId: siteA.id }, (client) =>
      createSubmission(client, { id: newUlid(), siteId: siteA.id, formId, values: { email: "visitor@example.com" }, ip: "203.0.113.1" }),
    );

    const fromB = await withTenantContext(appPool, { siteId: siteB.id }, (client) => getSubmission(client, siteB.id, submission.id));
    expect(fromB).toBeNull();

    const fromA = await withTenantContext(appPool, { siteId: siteA.id }, (client) => getSubmission(client, siteA.id, submission.id));
    expect(fromA?.values).toEqual({ email: "visitor@example.com" });

    const list = await withTenantContext(appPool, { siteId: siteA.id }, (client) => listSubmissions(client, siteA.id, formId));
    expect(list.total).toBe(1);
  });

  it("per-record deletion (PDPA/GDPR) removes exactly the targeted submission", async () => {
    const { site } = await makeSite("submissions-delete");
    const formId = newUlid();
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertPublishedForm(client, { id: formId, siteId: site.id, heading: "", fields: [], submitLabel: "Submit", turnstileEnabled: false }),
    );
    const a = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createSubmission(client, { id: newUlid(), siteId: site.id, formId, values: { name: "a" }, ip: null }),
    );
    const b = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createSubmission(client, { id: newUlid(), siteId: site.id, formId, values: { name: "b" }, ip: null }),
    );

    await withTenantContext(appPool, { siteId: site.id }, (client) => deleteSubmission(client, site.id, a.id));

    const remaining = await withTenantContext(appPool, { siteId: site.id }, (client) => listSubmissions(client, site.id, formId));
    expect(remaining.submissions.map((s) => s.id)).toEqual([b.id]);
  });
});

describe("webhook deliveries under RLS (Slice 6)", () => {
  it("a due delivery for one site never shows up in another site's due list", async () => {
    const { site: siteA } = await makeSite("webhooks-a");
    const { site: siteB } = await makeSite("webhooks-b");
    const formId = newUlid();
    await withTenantContext(appPool, { siteId: siteA.id }, (client) =>
      upsertPublishedForm(client, { id: formId, siteId: siteA.id, heading: "", fields: [], submitLabel: "Submit", turnstileEnabled: false }),
    );
    const submission = await withTenantContext(appPool, { siteId: siteA.id }, (client) =>
      createSubmission(client, { id: newUlid(), siteId: siteA.id, formId, values: {}, ip: null }),
    );
    await withTenantContext(appPool, { siteId: siteA.id }, (client) =>
      createWebhookDelivery(client, { id: newUlid(), siteId: siteA.id, submissionId: submission.id, url: "https://example.com/hook", secret: null, payload: { ok: true } }),
    );

    const dueForB = await withTenantContext(appPool, { siteId: siteB.id }, (client) => listDueWebhookDeliveries(client, siteB.id));
    expect(dueForB).toHaveLength(0);

    const dueForA = await withTenantContext(appPool, { siteId: siteA.id }, (client) => listDueWebhookDeliveries(client, siteA.id));
    expect(dueForA).toHaveLength(1);
  });

  it("recordWebhookAttempt updates attempt count, status and backoff", async () => {
    const { site } = await makeSite("webhooks-retry");
    const formId = newUlid();
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertPublishedForm(client, { id: formId, siteId: site.id, heading: "", fields: [], submitLabel: "Submit", turnstileEnabled: false }),
    );
    const submission = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createSubmission(client, { id: newUlid(), siteId: site.id, formId, values: {}, ip: null }),
    );
    const delivery = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createWebhookDelivery(client, { id: newUlid(), siteId: site.id, submissionId: submission.id, url: "https://example.invalid/hook", secret: null, payload: {} }),
    );

    const nextAttemptAt = new Date(Date.now() + 60_000);
    const updated = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      recordWebhookAttempt(client, delivery.id, { status: "pending", attempt: 1, lastError: "connect ECONNREFUSED", nextAttemptAt, deliveredAt: null }),
    );
    expect(updated.attempt).toBe(1);
    expect(updated.status).toBe("pending");
    expect(updated.lastError).toContain("ECONNREFUSED");

    const stillDue = await withTenantContext(appPool, { siteId: site.id }, (client) => listDueWebhookDeliveries(client, site.id));
    expect(stillDue).toHaveLength(0); // next_attempt_at is in the future
  });
});
