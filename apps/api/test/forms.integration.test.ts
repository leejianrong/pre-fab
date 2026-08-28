import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { newUlid, type PageDocument } from "@prefab/schema";
import { FORM_BLOCK_TYPE, formDefaultProps } from "@prefab/blocks";
import { withTenantContext, runMigrations, createAccount } from "@prefab/db";
import { FakeTurnstileVerifier } from "../src/lib/turnstile.js";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import type { EmailSender } from "../src/lib/email.js";

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
let webhookCalls: Array<{ url: string; body: unknown }>;
let webhookShouldFail: boolean;
let formEmailSender: EmailSender;
let sentEmails: Array<{ to: string; subject: string; text: string }>;
let emailShouldThrow: boolean;
const TEST_PLATFORM_HOST = "prefab-forms.test";

function testFetch(): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    webhookCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (webhookShouldFail) throw new Error("connect ECONNREFUSED");
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
}

beforeAll(async () => {
  await runMigrations(migratePool);
  await migratePool.query(
    "TRUNCATE webhook_deliveries, submissions, form_settings, forms, custom_domains, assets, publishes, blocks, pages, themes, sites, api_tokens, sessions, accounts CASCADE",
  );
  bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-forms-bundles-"));
  assetStoreDir = await mkdtemp(path.join(tmpdir(), "pf-forms-assets-"));

  formEmailSender = {
    async send(message) {
      if (emailShouldThrow) throw new Error("email provider unavailable");
      sentEmails.push(message);
    },
  };

  app = buildApp({
    pool: appPool,
    bundleStoreDir,
    assetStoreDir,
    platformHost: TEST_PLATFORM_HOST,
    turnstile: new FakeTurnstileVerifier(),
    formEmailSender,
    fetchImpl: testFetch(),
  });
  await app.ready();
});

beforeEach(() => {
  webhookCalls = [];
  webhookShouldFail = false;
  sentEmails = [];
  emailShouldThrow = false;
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

/** Creates a site, replaces its home page with a single Form block, and publishes — returns the live formId. */
async function createPublishedFormSite(
  cookie: string,
  formProps: Record<string, unknown> = formDefaultProps,
): Promise<{ siteId: string; formId: string }> {
  const created = await app.inject({
    method: "POST",
    url: "/v1/sites",
    headers: { cookie },
    payload: { slug: `form-site-${newUlid()}`, name: "Form Site" },
  });
  const { site, page } = created.json() as { site: { id: string }; page: PageDocument };
  const formId = newUlid();

  const write = await app.inject({
    method: "PUT",
    url: `/v1/sites/${site.id}/pages/${page.id}`,
    headers: { cookie },
    payload: {
      title: page.title,
      slug: page.slug,
      blocks: [{ id: formId, type: FORM_BLOCK_TYPE, parent: null, order: 1000, schemaVersion: 1, props: formProps }],
      expectedVersion: page.version,
    },
  });
  expect(write.statusCode).toBe(200);

  const publish = await app.inject({ method: "POST", url: `/v1/sites/${site.id}/publish`, headers: { cookie } });
  expect(publish.statusCode).toBe(200);

  return { siteId: site.id, formId };
}

describe("the runtime API — form submission (Slice 6, ADR-0007/ADR-0010)", () => {
  it("stores a submission on a published static page, emails the owner, and fires the webhook", async () => {
    const cookie = await seedAccountAndLogin(`forms-happy-${newUlid()}@example.com`);
    const { siteId, formId } = await createPublishedFormSite(cookie);

    await app.inject({
      method: "PUT",
      url: `/v1/sites/${siteId}/forms/${formId}`,
      headers: { cookie },
      payload: { notifyEmail: "owner@example.com", webhookUrl: "https://hooks.example.test/inbound" },
    });

    const submit = await app.inject({
      method: "POST",
      url: `/v1/runtime/forms/${formId}/submissions`,
      payload: { values: { name: "Ada Lovelace", email: "ada@example.com", message: "Hello there" } },
    });
    expect(submit.statusCode).toBe(201);
    const submissionId = (submit.json() as { id: string }).id;

    const list = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/forms/${formId}/submissions`, headers: { cookie } });
    const listBody = list.json() as { submissions: Array<{ id: string; values: Record<string, string>; notifyStatus: string }>; total: number };
    expect(listBody.total).toBe(1);
    expect(listBody.submissions[0]?.id).toBe(submissionId);
    expect(listBody.submissions[0]?.values.email).toBe("ada@example.com");
    expect(listBody.submissions[0]?.notifyStatus).toBe("sent");

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.to).toBe("owner@example.com");

    expect(webhookCalls).toHaveLength(1);
    expect(webhookCalls[0]?.url).toBe("https://hooks.example.test/inbound");
    expect((webhookCalls[0]?.body as { formId: string }).formId).toBe(formId);
  });

  it("rejects an invalid submission (missing a required field) with 400, storing nothing", async () => {
    const cookie = await seedAccountAndLogin(`forms-invalid-${newUlid()}@example.com`);
    const { formId } = await createPublishedFormSite(cookie);

    const submit = await app.inject({ method: "POST", url: `/v1/runtime/forms/${formId}/submissions`, payload: { values: {} } });
    expect(submit.statusCode).toBe(400);
    const body = submit.json() as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("404s for an unknown formId", async () => {
    const submit = await app.inject({ method: "POST", url: `/v1/runtime/forms/${newUlid()}/submissions`, payload: { values: {} } });
    expect(submit.statusCode).toBe(404);
  });

  it("enforces per-IP rate limiting with 429 and a Retry-After header", async () => {
    const cookie = await seedAccountAndLogin(`forms-ratelimit-${newUlid()}@example.com`);
    const { formId } = await createPublishedFormSite(cookie);
    const payload = { values: { name: "A", email: "a@example.com", message: "hi" } };

    let lastStatus = 0;
    for (let i = 0; i < 8; i++) {
      const response = await app.inject({ method: "POST", url: `/v1/runtime/forms/${formId}/submissions`, payload });
      lastStatus = response.statusCode;
      if (lastStatus === 429) {
        expect(response.headers["retry-after"]).toBeDefined();
        break;
      }
    }
    expect(lastStatus).toBe(429);
  });

  it("rejects a submission with no Turnstile token when the form has Turnstile enabled", async () => {
    const cookie = await seedAccountAndLogin(`forms-turnstile-${newUlid()}@example.com`);
    const { formId } = await createPublishedFormSite(cookie, { ...formDefaultProps, turnstileEnabled: true });

    const submit = await app.inject({
      method: "POST",
      url: `/v1/runtime/forms/${formId}/submissions`,
      payload: { values: { name: "A", email: "a@example.com", message: "hi" } },
    });
    expect(submit.statusCode).toBe(403);
  });

  it("a form on a page with the email provider unavailable still stores the submission and surfaces the failure (R7.4)", async () => {
    const cookie = await seedAccountAndLogin(`forms-emailfail-${newUlid()}@example.com`);
    const { siteId, formId } = await createPublishedFormSite(cookie);
    await app.inject({
      method: "PUT",
      url: `/v1/sites/${siteId}/forms/${formId}`,
      headers: { cookie },
      payload: { notifyEmail: "owner@example.com" },
    });

    emailShouldThrow = true;
    const submit = await app.inject({
      method: "POST",
      url: `/v1/runtime/forms/${formId}/submissions`,
      payload: { values: { name: "A", email: "a@example.com", message: "hi" } },
    });
    expect(submit.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/forms/${formId}/submissions`, headers: { cookie } });
    const body = list.json() as { submissions: Array<{ notifyStatus: string; notifyError: string | null }> };
    expect(body.submissions[0]?.notifyStatus).toBe("failed");
    expect(body.submissions[0]?.notifyError).toContain("unavailable");
  });

  it("exports submissions as CSV with correct escaping, and as JSON", async () => {
    const cookie = await seedAccountAndLogin(`forms-export-${newUlid()}@example.com`);
    const { siteId, formId } = await createPublishedFormSite(cookie);

    await app.inject({
      method: "POST",
      url: `/v1/runtime/forms/${formId}/submissions`,
      payload: { values: { name: "Ada, Lovelace", email: "ada@example.com", message: 'She said "hi"' } },
    });

    const csv = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/forms/${formId}/submissions/export?format=csv`, headers: { cookie } });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain('"Ada, Lovelace"');
    expect(csv.body).toContain('"She said ""hi"""');

    const json = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/forms/${formId}/submissions/export?format=json`, headers: { cookie } });
    const jsonBody = json.json() as Array<{ values: Record<string, string> }>;
    expect(jsonBody[0]?.values.name).toBe("Ada, Lovelace");
  });

  it("deletes a single submission on request (PDPA/GDPR), leaving others intact", async () => {
    const cookie = await seedAccountAndLogin(`forms-delete-${newUlid()}@example.com`);
    const { siteId, formId } = await createPublishedFormSite(cookie);

    const first = await app.inject({
      method: "POST",
      url: `/v1/runtime/forms/${formId}/submissions`,
      payload: { values: { name: "A", email: "a@example.com", message: "one" } },
    });
    const second = await app.inject({
      method: "POST",
      url: `/v1/runtime/forms/${formId}/submissions`,
      payload: { values: { name: "B", email: "b@example.com", message: "two" } },
    });
    const firstId = (first.json() as { id: string }).id;
    const secondId = (second.json() as { id: string }).id;

    const del = await app.inject({
      method: "DELETE",
      url: `/v1/sites/${siteId}/forms/${formId}/submissions/${firstId}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/forms/${formId}/submissions`, headers: { cookie } });
    const body = list.json() as { submissions: Array<{ id: string }> };
    expect(body.submissions.map((s) => s.id)).toEqual([secondId]);
  });

  it("retries a failed webhook delivery once it's due (Integration: webhook retry and backoff)", async () => {
    const cookie = await seedAccountAndLogin(`forms-webhookretry-${newUlid()}@example.com`);
    const { siteId, formId } = await createPublishedFormSite(cookie);
    await app.inject({
      method: "PUT",
      url: `/v1/sites/${siteId}/forms/${formId}`,
      headers: { cookie },
      payload: { webhookUrl: "https://hooks.example.test/inbound" },
    });

    webhookShouldFail = true;
    const submit = await app.inject({
      method: "POST",
      url: `/v1/runtime/forms/${formId}/submissions`,
      payload: { values: { name: "A", email: "a@example.com", message: "hi" } },
    });
    expect(submit.statusCode).toBe(201);
    expect(webhookCalls).toHaveLength(1); // the first, failing attempt

    // Force the scheduled retry to be immediately due, rather than waiting
    // out the real 30s backoff — deterministic and fast. webhook_deliveries
    // is FORCE ROW LEVEL SECURITY (0006_slice6.sql), so even this raw
    // owner-role query needs tenant context set to be allowed to touch the row.
    await withTenantContext(appPool, { siteId }, (client) =>
      client.query("UPDATE webhook_deliveries SET next_attempt_at = now() - interval '1 minute' WHERE site_id = $1", [siteId]),
    );

    webhookShouldFail = false;
    const retry = await app.inject({ method: "POST", url: `/v1/dev/webhooks/${siteId}/retry` });
    expect(retry.statusCode).toBe(200);
    expect((retry.json() as { retried: number }).retried).toBe(1);
    expect(webhookCalls).toHaveLength(2); // the retried, successful attempt
  });
});
