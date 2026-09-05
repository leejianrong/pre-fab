import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { newUlid, type PageDocument } from "@prefab/schema";
import { EVENTSIGNUP_BLOCK_TYPE, eventSignupDefaultProps } from "@prefab/blocks";
import { withTenantContext, runMigrations, createAccount } from "@prefab/db";
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
let sentEmails: Array<{ to: string; subject: string; text: string }>;
const TEST_PLATFORM_HOST = "prefab-eventsignups.test";

beforeAll(async () => {
  await runMigrations(migratePool);
  await migratePool.query(
    "TRUNCATE event_signups, event_signup_widgets, custom_domains, assets, publishes, blocks, pages, themes, sites, api_tokens, sessions, accounts CASCADE",
  );
  bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-eventsignups-bundles-"));
  assetStoreDir = await mkdtemp(path.join(tmpdir(), "pf-eventsignups-assets-"));

  const eventSignupEmailSender: EmailSender = {
    async send(message) {
      sentEmails.push(message);
    },
  };

  app = buildApp({
    pool: appPool,
    bundleStoreDir,
    assetStoreDir,
    platformHost: TEST_PLATFORM_HOST,
    eventSignupEmailSender,
    runtimeApiUrl: "http://localhost:8787",
  });
  await app.ready();
});

beforeEach(() => {
  sentEmails = [];
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

function eventSignupBlock(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: EVENTSIGNUP_BLOCK_TYPE,
    parent: null,
    order: 1000,
    schemaVersion: 1,
    props: { ...eventSignupDefaultProps, ...overrides },
  };
}

async function createPublishedEventSignupSite(cookie: string, overrides: Record<string, unknown> = {}): Promise<{ siteId: string; widgetId: string }> {
  const created = await app.inject({ method: "POST", url: "/v1/sites", headers: { cookie }, payload: { slug: `eventsignup-site-${newUlid()}`, name: "Event Site" } });
  const { site, page } = created.json() as { site: { id: string }; page: PageDocument };
  const widgetId = newUlid();

  const write = await app.inject({
    method: "PUT",
    url: `/v1/sites/${site.id}/pages/${page.id}`,
    headers: { cookie },
    payload: {
      title: page.title,
      slug: page.slug,
      blocks: [eventSignupBlock(widgetId, overrides)],
      expectedVersion: page.version,
    },
  });
  expect(write.statusCode).toBe(200);

  const publish = await app.inject({ method: "POST", url: `/v1/sites/${site.id}/publish`, headers: { cookie } });
  expect(publish.statusCode).toBe(200);

  return { siteId: site.id, widgetId };
}

describe("the runtime API — event sign-ups (KAN-1138)", () => {
  it("publish snapshots the widget's heading/fields/capacity/waitlist into event_signup_widgets", async () => {
    const cookie = await seedAccountAndLogin(`eventsignup-publish-${newUlid()}@example.com`);
    const { siteId, widgetId } = await createPublishedEventSignupSite(cookie, { heading: "Community Picnic", capacity: 5, waitlistEnabled: false });

    const widget = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/event-signups/${widgetId}`, headers: { cookie } });
    expect(widget.statusCode).toBe(200);
    const widgetBody = widget.json() as { heading: string; capacity: number | null; waitlistEnabled: boolean };
    expect(widgetBody.heading).toBe("Community Picnic");
    expect(widgetBody.capacity).toBe(5);
    expect(widgetBody.waitlistEnabled).toBe(false);
  });

  it("a visitor signs up, is confirmed, and the owner is notified", async () => {
    const cookie = await seedAccountAndLogin(`eventsignup-happy-${newUlid()}@example.com`);
    const { siteId, widgetId } = await createPublishedEventSignupSite(cookie, { capacity: 10 });

    const signup = await app.inject({
      method: "POST",
      url: `/v1/runtime/event-signups/${widgetId}/signups`,
      payload: { values: { name: "Ada Lovelace", email: "ada@example.com" } },
    });
    expect(signup.statusCode).toBe(201);
    expect((signup.json() as { status: string }).status).toBe("confirmed");

    expect(sentEmails.length).toBeGreaterThan(0);
    expect(sentEmails[0]?.subject).toContain("New event sign-up");

    const list = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/event-signups/${widgetId}/signups`, headers: { cookie } });
    const listBody = list.json() as { total: number; signups: Array<{ status: string; values: Record<string, unknown> }> };
    expect(listBody.total).toBe(1);
    expect(listBody.signups[0]?.status).toBe("confirmed");
    expect(listBody.signups[0]?.values).toMatchObject({ name: "Ada Lovelace" });
  });

  const nameOnlyField = [{ type: "text", label: "Name", name: "name", required: true, options: "" }];

  it("waitlists a sign-up once capacity is exhausted, and rejects as full once the waitlist is also disabled", async () => {
    const cookie = await seedAccountAndLogin(`eventsignup-waitlist-${newUlid()}@example.com`);
    const { widgetId: waitlistedWidgetId } = await createPublishedEventSignupSite(cookie, { capacity: 1, waitlistEnabled: true, fields: nameOnlyField });

    const first = await app.inject({ method: "POST", url: `/v1/runtime/event-signups/${waitlistedWidgetId}/signups`, payload: { values: { name: "First" } } });
    expect(first.statusCode).toBe(201);
    expect((first.json() as { status: string }).status).toBe("confirmed");

    const second = await app.inject({ method: "POST", url: `/v1/runtime/event-signups/${waitlistedWidgetId}/signups`, payload: { values: { name: "Second" } } });
    expect(second.statusCode).toBe(201);
    const secondBody = second.json() as { status: string; position: number };
    expect(secondBody.status).toBe("waitlisted");
    expect(secondBody.position).toBe(1);

    const { widgetId: fullWidgetId } = await createPublishedEventSignupSite(cookie, { capacity: 1, waitlistEnabled: false, fields: nameOnlyField });
    const confirmed = await app.inject({ method: "POST", url: `/v1/runtime/event-signups/${fullWidgetId}/signups`, payload: { values: { name: "Only spot" } } });
    expect(confirmed.statusCode).toBe(201);
    const rejected = await app.inject({ method: "POST", url: `/v1/runtime/event-signups/${fullWidgetId}/signups`, payload: { values: { name: "Too late" } } });
    expect(rejected.statusCode).toBe(409);
  });

  it("two concurrent sign-ups for the last spot resolve to exactly one confirmed and one waitlisted", async () => {
    const cookie = await seedAccountAndLogin(`eventsignup-race-${newUlid()}@example.com`);
    const { siteId, widgetId } = await createPublishedEventSignupSite(cookie, { capacity: 1, waitlistEnabled: true, fields: nameOnlyField });

    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: `/v1/runtime/event-signups/${widgetId}/signups`, payload: { values: { name: "Racer A" } } }),
      app.inject({ method: "POST", url: `/v1/runtime/event-signups/${widgetId}/signups`, payload: { values: { name: "Racer B" } } }),
    ]);
    const statuses = [a.json() as { status: string }, b.json() as { status: string }].map((r) => r.status).sort();
    expect(statuses).toEqual(["confirmed", "waitlisted"]);

    const list = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/event-signups/${widgetId}/signups`, headers: { cookie } });
    expect((list.json() as { total: number }).total).toBe(2);
  });

  it("rejects an invalid sign-up (missing a required field)", async () => {
    const cookie = await seedAccountAndLogin(`eventsignup-invalid-${newUlid()}@example.com`);
    const { widgetId } = await createPublishedEventSignupSite(cookie, {
      fields: [{ type: "text", label: "Name", name: "name", required: true, options: "" }],
    });
    const res = await app.inject({ method: "POST", url: `/v1/runtime/event-signups/${widgetId}/signups`, payload: { values: {} } });
    expect(res.statusCode).toBe(400);
  });

  it("404s a sign-up against an unpublished/unknown widget id", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/runtime/event-signups/${newUlid()}/signups`, payload: { values: {} } });
    expect(res.statusCode).toBe(404);
  });

  it("exports sign-ups as CSV and a single record can be deleted", async () => {
    const cookie = await seedAccountAndLogin(`eventsignup-export-${newUlid()}@example.com`);
    const { siteId, widgetId } = await createPublishedEventSignupSite(cookie, {
      capacity: 10,
      fields: [{ type: "text", label: "Name", name: "name", required: true, options: "" }],
    });

    for (const name of ["Grace Hopper", "Alan Turing"]) {
      const res = await app.inject({ method: "POST", url: `/v1/runtime/event-signups/${widgetId}/signups`, payload: { values: { name } } });
      expect(res.statusCode).toBe(201);
    }

    const csv = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/event-signups/${widgetId}/signups/export?format=csv`, headers: { cookie } });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain("Grace Hopper");
    expect(csv.body).toContain("Alan Turing");
    expect(csv.body.split("\r\n").filter(Boolean)).toHaveLength(3); // header + 2 rows

    const before = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/event-signups/${widgetId}/signups`, headers: { cookie } });
    const beforeBody = before.json() as { total: number; signups: Array<{ id: string; values: Record<string, unknown> }> };
    expect(beforeBody.total).toBe(2);
    const toDelete = beforeBody.signups.find((s) => s.values.name === "Grace Hopper")!;

    const del = await app.inject({ method: "DELETE", url: `/v1/sites/${siteId}/event-signups/${widgetId}/signups/${toDelete.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/event-signups/${widgetId}/signups`, headers: { cookie } });
    const afterBody = after.json() as { total: number; signups: Array<{ values: Record<string, unknown> }> };
    expect(afterBody.total).toBe(1);
    expect(afterBody.signups[0]?.values.name).toBe("Alan Turing");
  });

  it("a site's event sign-ups are invisible to an unrelated account (RLS/authorization, ADR-0008)", async () => {
    const ownerCookie = await seedAccountAndLogin(`eventsignup-owner-${newUlid()}@example.com`);
    const { siteId, widgetId } = await createPublishedEventSignupSite(ownerCookie, { capacity: 10 });
    await app.inject({ method: "POST", url: `/v1/runtime/event-signups/${widgetId}/signups`, payload: { values: { name: "Owner's visitor" } } });

    const strangerCookie = await seedAccountAndLogin(`eventsignup-stranger-${newUlid()}@example.com`);
    const res = await app.inject({ method: "GET", url: `/v1/sites/${siteId}/event-signups/${widgetId}/signups`, headers: { cookie: strangerCookie } });
    expect(res.statusCode).toBe(403);
  });
});
