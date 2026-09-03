import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newUlid } from "@prefab/schema";
import { createPool, runMigrations, withTenantContext } from "../src/index.js";
import { createAccount, createSite } from "../src/repositories/index.js";
import { getEventSignupWidget, getEventSignupWidgetPublic, upsertPublishedEventSignupWidget } from "../src/repositories/event-signup-widgets.js";
import { createEventSignup, getEventSignup, listEventSignups } from "../src/repositories/event-signups.js";

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

async function makeWidget(siteId: string, overrides: { capacity?: number | null; waitlistEnabled?: boolean } = {}) {
  const widgetId = newUlid();
  await withTenantContext(appPool, { siteId }, (client) =>
    upsertPublishedEventSignupWidget(client, {
      id: widgetId,
      siteId,
      heading: "Sign up",
      fields: [{ type: "text", label: "Name", name: "name", required: true }],
      capacity: overrides.capacity ?? null,
      waitlistEnabled: overrides.waitlistEnabled ?? true,
      submitLabel: "Reserve my spot",
    }),
  );
  return widgetId;
}

describe("event_signup_widgets (KAN-1138)", () => {
  it("getEventSignupWidgetPublic resolves with no tenant context — the runtime's own resolution path", async () => {
    const { site } = await makeSite("widget-public");
    const widgetId = await makeWidget(site.id);
    const found = await withTenantContext(appPool, {}, (client) => getEventSignupWidgetPublic(client, widgetId));
    expect(found?.siteId).toBe(site.id);
  });

  it("upsertPublishedEventSignupWidget is idempotent per block id (ON CONFLICT (id))", async () => {
    const { site } = await makeSite("widget-idempotent");
    const widgetId = newUlid();
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertPublishedEventSignupWidget(client, {
        id: widgetId,
        siteId: site.id,
        heading: "Original",
        fields: [],
        capacity: 10,
        waitlistEnabled: true,
        submitLabel: "Go",
      }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      upsertPublishedEventSignupWidget(client, {
        id: widgetId,
        siteId: site.id,
        heading: "Updated",
        fields: [],
        capacity: 5,
        waitlistEnabled: false,
        submitLabel: "Go now",
      }),
    );
    const widget = await withTenantContext(appPool, { siteId: site.id }, (client) => getEventSignupWidget(client, site.id, widgetId));
    expect(widget?.heading).toBe("Updated");
    expect(widget?.capacity).toBe(5);
    expect(widget?.waitlistEnabled).toBe(false);
  });
});

describe("event_signups — RLS tenant isolation", () => {
  it("a site's event sign-ups are invisible under another site's tenant context", async () => {
    const { site: siteA } = await makeSite("events-tenant-a");
    const { site: siteB } = await makeSite("events-tenant-b");
    const widgetId = await makeWidget(siteA.id);

    const signupId = newUlid();
    await withTenantContext(appPool, { siteId: siteA.id }, (client) =>
      createEventSignup(client, { id: signupId, widgetId, siteId: siteA.id, values: { name: "Ada" }, capacity: null, waitlistEnabled: true }),
    );

    const underA = await withTenantContext(appPool, { siteId: siteA.id }, (client) => getEventSignup(client, siteA.id, signupId));
    expect(underA?.id).toBe(signupId);

    // Same id, wrong tenant context — application-level filtering (site_id
    // in the WHERE clause) already prevents a match, but RLS is the actual
    // backstop (ADR-0008): a raw, unscoped listing under siteB's context
    // must never surface siteA's own rows either.
    const underB = await withTenantContext(appPool, { siteId: siteB.id }, (client) => getEventSignup(client, siteB.id, signupId));
    expect(underB).toBeNull();

    const listUnderB = await withTenantContext(appPool, { siteId: siteB.id }, (client) => listEventSignups(client, siteB.id, widgetId));
    expect(listUnderB.total).toBe(0);
  });

  it("carries no public read policy — a context-free read never resolves a sign-up", async () => {
    const { site } = await makeSite("events-secret");
    const widgetId = await makeWidget(site.id);
    const signupId = newUlid();
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createEventSignup(client, { id: signupId, widgetId, siteId: site.id, values: { name: "Secret" }, capacity: null, waitlistEnabled: true }),
    );
    const contextFree = await withTenantContext(appPool, {}, (client) => getEventSignup(client, site.id, signupId));
    expect(contextFree).toBeNull();
  });
});

describe("event_signups — capacity concurrency (ADR-0006 applied to a count, not a single slot)", () => {
  it("two concurrent sign-ups for the last remaining spot resolve to exactly one confirmed and one waitlisted", async () => {
    const { site } = await makeSite("events-race");
    const widgetId = await makeWidget(site.id, { capacity: 1, waitlistEnabled: true });

    const attempt = (suffix: string) =>
      withTenantContext(appPool, { siteId: site.id }, (client) =>
        createEventSignup(client, {
          id: newUlid(),
          widgetId,
          siteId: site.id,
          values: { name: `Visitor ${suffix}` },
          capacity: 1,
          waitlistEnabled: true,
        }),
      );

    const [a, b] = await Promise.all([attempt("a"), attempt("b")]);
    const results = [a, b];
    expect(results.filter((r) => r.status === "confirmed")).toHaveLength(1);
    expect(results.filter((r) => r.status === "waitlisted")).toHaveLength(1);

    const list = await withTenantContext(appPool, { siteId: site.id }, (client) => listEventSignups(client, site.id, widgetId));
    expect(list.total).toBe(2);
    expect(list.signups.filter((s) => s.status === "confirmed")).toHaveLength(1);
    expect(list.signups.filter((s) => s.status === "waitlisted")).toHaveLength(1);
  });

  it("rejects a sign-up as full once capacity is reached and the waitlist is disabled", async () => {
    const { site } = await makeSite("events-full");
    const widgetId = await makeWidget(site.id, { capacity: 1, waitlistEnabled: false });

    const first = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createEventSignup(client, { id: newUlid(), widgetId, siteId: site.id, values: { name: "First" }, capacity: 1, waitlistEnabled: false }),
    );
    expect(first.status).toBe("confirmed");

    const second = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createEventSignup(client, { id: newUlid(), widgetId, siteId: site.id, values: { name: "Second" }, capacity: 1, waitlistEnabled: false }),
    );
    expect(second.status).toBe("full");
  });

  it("assigns increasing waitlist positions in the order sign-ups land", async () => {
    const { site } = await makeSite("events-waitlist-order");
    const widgetId = await makeWidget(site.id, { capacity: 1, waitlistEnabled: true });
    // The first sign-up consumes the only spot, so both remaining calls
    // land on the waitlist in sequence.
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createEventSignup(client, { id: newUlid(), widgetId, siteId: site.id, values: { name: "Confirmed" }, capacity: 1, waitlistEnabled: true }),
    );

    const second = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createEventSignup(client, { id: newUlid(), widgetId, siteId: site.id, values: { name: "Second" }, capacity: 1, waitlistEnabled: true }),
    );
    const third = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createEventSignup(client, { id: newUlid(), widgetId, siteId: site.id, values: { name: "Third" }, capacity: 1, waitlistEnabled: true }),
    );

    expect(second.status).toBe("waitlisted");
    expect(third.status).toBe("waitlisted");
    if (second.status === "waitlisted" && third.status === "waitlisted") {
      expect(second.position).toBe(1);
      expect(third.position).toBe(2);
    }
  });
});
