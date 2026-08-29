import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newUlid, DEFAULT_THEME_TOKENS } from "@prefab/schema";
import { createPool, runMigrations, withTenantContext } from "../src/index.js";
import { createAccount, createSite, getSite, getSiteBySlug, listSitesForAccount } from "../src/repositories/index.js";
import { createTheme, getTheme } from "../src/repositories/themes.js";
import { createPage, getPageDocument, writePageDocument } from "../src/repositories/pages.js";
import { createPublish, getLivePublish, setLivePublish } from "../src/repositories/publishes.js";
import { createCustomDomain, findActiveCustomDomainByHostname, updateCustomDomainStatus } from "../src/repositories/custom-domains.js";
import { addSiteMember, getSiteMemberRole } from "../src/repositories/site-members.js";

const migrateUrl = process.env.MIGRATE_DATABASE_URL_TEST;
const appUrl = process.env.DATABASE_URL_TEST;

if (!migrateUrl || !appUrl) {
  throw new Error(
    "MIGRATE_DATABASE_URL_TEST and DATABASE_URL_TEST must be set — see .env.example and scripts/db-up.sh",
  );
}

const migratePool = createPool(migrateUrl);
const appPool = createPool(appUrl);

beforeAll(async () => {
  await runMigrations(migratePool);
  // Integration tests own the whole test database; start from a clean slate.
  await migratePool.query(
    "TRUNCATE custom_domains, publishes, blocks, pages, themes, sites, api_tokens, sessions, accounts CASCADE",
  );
});

afterAll(async () => {
  await migratePool.end();
  await appPool.end();
});

describe("row-level security (ADR-0008)", () => {
  it("a cross-tenant read returns nothing, even though the row exists", async () => {
    const ownerA = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `a-${newUlid()}@example.com` }),
    );
    await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `b-${newUlid()}@example.com` }),
    );

    const siteA = await withTenantContext(appPool, { accountId: ownerA.id }, (client) =>
      createSite(client, { id: newUlid(), slug: `site-a-${newUlid()}`, name: "Site A", ownerId: ownerA.id }),
    );

    // siteB's own connection asks for siteA's row by id — RLS scopes the
    // query to siteB's own context, so the row that undeniably exists comes
    // back as nothing rather than as a permission error.
    const crossTenantRead = await withTenantContext(appPool, { siteId: newUlid() /* siteB, never created */ }, (client) =>
      getSite(client, siteA.id),
    );
    expect(crossTenantRead).toBeNull();

    const ownRead = await withTenantContext(appPool, { siteId: siteA.id }, (client) => getSite(client, siteA.id));
    expect(ownRead?.id).toBe(siteA.id);
  });

  it("an insert whose owner_id does not match the account context is rejected by RLS, not just by application code", async () => {
    const owner = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `owner-${newUlid()}@example.com` }),
    );
    const attacker = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `attacker-${newUlid()}@example.com` }),
    );

    await expect(
      withTenantContext(appPool, { accountId: attacker.id }, (client) =>
        createSite(client, { id: newUlid(), slug: `hijack-${newUlid()}`, name: "Hijack", ownerId: owner.id }),
      ),
    ).rejects.toThrow();
  });

  it("listSitesForAccount only ever returns the caller's own sites", async () => {
    const ownerA = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `list-a-${newUlid()}@example.com` }),
    );
    const ownerB = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `list-b-${newUlid()}@example.com` }),
    );
    await withTenantContext(appPool, { accountId: ownerA.id }, (client) =>
      createSite(client, { id: newUlid(), slug: `list-site-a-${newUlid()}`, name: "A", ownerId: ownerA.id }),
    );
    await withTenantContext(appPool, { accountId: ownerB.id }, (client) =>
      createSite(client, { id: newUlid(), slug: `list-site-b-${newUlid()}`, name: "B", ownerId: ownerB.id }),
    );

    const asA = await withTenantContext(appPool, { accountId: ownerA.id }, (client) =>
      listSitesForAccount(client, ownerA.id),
    );
    expect(asA.every((s) => s.ownerId === ownerA.id)).toBe(true);
    expect(asA.some((s) => s.ownerId === ownerB.id)).toBe(false);
  });

  it("themes, pages and publishes are all scoped by site_id — a page created for one site is invisible under another's context", async () => {
    const owner = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `pages-${newUlid()}@example.com` }),
    );
    const siteA = await withTenantContext(appPool, { accountId: owner.id }, (client) =>
      createSite(client, { id: newUlid(), slug: `pages-a-${newUlid()}`, name: "Pages A", ownerId: owner.id }),
    );
    const siteB = await withTenantContext(appPool, { accountId: owner.id }, (client) =>
      createSite(client, { id: newUlid(), slug: `pages-b-${newUlid()}`, name: "Pages B", ownerId: owner.id }),
    );

    await withTenantContext(appPool, { siteId: siteA.id }, (client) =>
      createTheme(client, { id: newUlid(), siteId: siteA.id, tokens: DEFAULT_THEME_TOKENS }),
    );
    const page = await withTenantContext(appPool, { siteId: siteA.id }, (client) =>
      createPage(client, { id: newUlid(), siteId: siteA.id, slug: "home", title: "Home" }),
    );

    const themeFromB = await withTenantContext(appPool, { siteId: siteB.id }, (client) => getTheme(client, siteA.id));
    expect(themeFromB).toBeNull();

    const pageFromB = await withTenantContext(appPool, { siteId: siteB.id }, (client) =>
      getPageDocument(client, page.id),
    );
    expect(pageFromB).toBeNull();

    const pageFromA = await withTenantContext(appPool, { siteId: siteA.id }, (client) =>
      getPageDocument(client, page.id),
    );
    expect(pageFromA?.id).toBe(page.id);
  });
});

describe("public read policies (Slice 4, R1/ADR-0007) — no tenant context, scoped narrowly", () => {
  it("getSiteBySlug with no context finds a published site but not an unpublished one", async () => {
    const owner = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `pub-slug-${newUlid()}@example.com` }),
    );
    const published = await withTenantContext(appPool, { accountId: owner.id }, (client) =>
      createSite(client, { id: newUlid(), slug: `published-${newUlid()}`, name: "Published", ownerId: owner.id }),
    );
    const unpublished = await withTenantContext(appPool, { accountId: owner.id }, (client) =>
      createSite(client, { id: newUlid(), slug: `unpublished-${newUlid()}`, name: "Unpublished", ownerId: owner.id }),
    );
    await withTenantContext(appPool, { siteId: published.id }, (client) =>
      createPublish(client, { id: newUlid(), siteId: published.id, bundlePath: "b", contentHash: "h", createdBy: owner.id }).then(
        (publish) => setLivePublish(client, published.id, publish.id),
      ),
    );

    // No site_id, no account_id — exactly the context host-based routing has.
    const foundPublished = await withTenantContext(appPool, {}, (client) => getSiteBySlug(client, published.slug));
    expect(foundPublished?.id).toBe(published.id);

    const foundUnpublished = await withTenantContext(appPool, {}, (client) => getSiteBySlug(client, unpublished.slug));
    expect(foundUnpublished).toBeNull();
  });

  it("findActiveCustomDomainByHostname with no context finds only an active domain, never a pending or failed one", async () => {
    const owner = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `pub-domain-${newUlid()}@example.com` }),
    );
    const site = await withTenantContext(appPool, { accountId: owner.id }, (client) =>
      createSite(client, { id: newUlid(), slug: `domain-rls-${newUlid()}`, name: "Domain RLS", ownerId: owner.id }),
    );

    const activeHostname = `active-${newUlid()}.example.test`;
    const pendingHostname = `pending-${newUlid()}.example.test`;
    const active = await withTenantContext(appPool, { siteId: site.id, accountId: owner.id }, (client) =>
      createCustomDomain(client, {
        id: newUlid(),
        siteId: site.id,
        hostname: activeHostname,
        isApex: false,
        providerHostnameId: "fake_1",
        cnameTarget: "customer-domains.prefab.test",
        createdBy: owner.id,
      }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      updateCustomDomainStatus(client, active.id, { status: "active", verificationError: null }),
    );
    await withTenantContext(appPool, { siteId: site.id, accountId: owner.id }, (client) =>
      createCustomDomain(client, {
        id: newUlid(),
        siteId: site.id,
        hostname: pendingHostname,
        isApex: false,
        providerHostnameId: "fake_2",
        cnameTarget: "customer-domains.prefab.test",
        createdBy: owner.id,
      }),
    );

    const foundActive = await withTenantContext(appPool, {}, (client) => findActiveCustomDomainByHostname(client, activeHostname));
    expect(foundActive?.siteId).toBe(site.id);

    const foundPending = await withTenantContext(appPool, {}, (client) => findActiveCustomDomainByHostname(client, pendingHostname));
    expect(foundPending).toBeNull();
  });
});

describe("site_members roles (Slice 8) — RLS enforcement, not just application logic", () => {
  it("getSiteMemberRole resolves owner/editor/viewer correctly, and null for an account with no relationship to the site", async () => {
    const owner = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `role-owner-${newUlid()}@example.com` }),
    );
    const editor = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `role-editor-${newUlid()}@example.com` }),
    );
    const viewer = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `role-viewer-${newUlid()}@example.com` }),
    );
    const outsider = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `role-outsider-${newUlid()}@example.com` }),
    );
    const site = await withTenantContext(appPool, { accountId: owner.id }, (client) =>
      createSite(client, { id: newUlid(), slug: `roles-${newUlid()}`, name: "Roles", ownerId: owner.id }),
    );
    await withTenantContext(appPool, { siteId: site.id, accountId: owner.id }, (client) =>
      addSiteMember(client, { siteId: site.id, accountId: owner.id, role: "owner" }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      addSiteMember(client, { siteId: site.id, accountId: editor.id, role: "editor" }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      addSiteMember(client, { siteId: site.id, accountId: viewer.id, role: "viewer" }),
    );

    expect(await withTenantContext(appPool, { siteId: site.id }, (client) => getSiteMemberRole(client, site.id, owner.id))).toBe("owner");
    expect(await withTenantContext(appPool, { siteId: site.id }, (client) => getSiteMemberRole(client, site.id, editor.id))).toBe("editor");
    expect(await withTenantContext(appPool, { siteId: site.id }, (client) => getSiteMemberRole(client, site.id, viewer.id))).toBe("viewer");
    expect(await withTenantContext(appPool, { siteId: site.id }, (client) => getSiteMemberRole(client, site.id, outsider.id))).toBeNull();
  });

  it("an invited editor or viewer can see the site row via sites_member_access, even though they are not sites.owner_id", async () => {
    const owner = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `member-access-owner-${newUlid()}@example.com` }),
    );
    const viewer = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `member-access-viewer-${newUlid()}@example.com` }),
    );
    const site = await withTenantContext(appPool, { accountId: owner.id }, (client) =>
      createSite(client, { id: newUlid(), slug: `member-access-${newUlid()}`, name: "Member Access", ownerId: owner.id }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      addSiteMember(client, { siteId: site.id, accountId: viewer.id, role: "viewer" }),
    );

    // sites_owner_access alone would reject this (owner_id !== viewer.id) —
    // sites_member_access is what makes it visible.
    const asViewer = await withTenantContext(appPool, { accountId: viewer.id, siteId: site.id }, (client) => getSite(client, site.id));
    expect(asViewer?.id).toBe(site.id);
  });

  it("an account with no site_members row and no siteId context of its own cannot discover the site — sites_owner_access and sites_member_access both fail closed", async () => {
    const owner = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `no-member-owner-${newUlid()}@example.com` }),
    );
    const outsider = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `no-member-outsider-${newUlid()}@example.com` }),
    );
    const site = await withTenantContext(appPool, { accountId: owner.id }, (client) =>
      createSite(client, { id: newUlid(), slug: `no-member-${newUlid()}`, name: "No Member", ownerId: owner.id }),
    );

    // No siteId in context (the outsider does not already know it's
    // authorized for this site — the same shape listSitesForAccount's own
    // cross-tenant test above uses): neither owner-equality nor a
    // site_members row exists for this account, so the row stays invisible.
    const asOutsider = await withTenantContext(appPool, { accountId: outsider.id }, (client) => getSite(client, site.id));
    expect(asOutsider).toBeNull();

    // authorizeSite's actual shape does set siteId context to resolve
    // role (it must, to read site_members at all) — what stays enforced
    // there is getSiteMemberRole itself returning null, checked above.
    expect(
      await withTenantContext(appPool, { accountId: outsider.id, siteId: site.id }, (client) => getSiteMemberRole(client, site.id, outsider.id)),
    ).toBeNull();
  });
});

describe("optimistic concurrency (ADR-0006 / R17)", () => {
  it("rejects a write against a stale version and leaves the prior write intact", async () => {
    const owner = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `oc-${newUlid()}@example.com` }),
    );
    const site = await withTenantContext(appPool, { accountId: owner.id }, (client) =>
      createSite(client, { id: newUlid(), slug: `oc-${newUlid()}`, name: "OC", ownerId: owner.id }),
    );
    const page = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createPage(client, { id: newUlid(), siteId: site.id, slug: "home", title: "Home" }),
    );

    const firstWrite = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      writePageDocument(client, {
        pageId: page.id,
        siteId: site.id,
        title: "First edit",
        slug: "home",
        blocks: [],
        expectedVersion: 0,
      }),
    );
    expect(firstWrite.ok).toBe(true);

    const staleWrite = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      writePageDocument(client, {
        pageId: page.id,
        siteId: site.id,
        title: "Stale edit — should be rejected",
        slug: "home",
        blocks: [],
        expectedVersion: 0, // stale: the page is now at version 1
      }),
    );

    expect(staleWrite.ok).toBe(false);
    if (!staleWrite.ok) {
      expect(staleWrite.current.title).toBe("First edit");
      expect(staleWrite.current.version).toBe(1);
    }

    const stillThere = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      getPageDocument(client, page.id),
    );
    expect(stillThere?.title).toBe("First edit");
  });
});

describe("publish pointer swap (ADR-0007 / R5)", () => {
  it("setLivePublish flips exactly one live publish per site, atomically", async () => {
    const owner = await withTenantContext(migratePool, {}, (client) =>
      createAccount(client, { id: newUlid(), email: `pub-${newUlid()}@example.com` }),
    );
    const site = await withTenantContext(appPool, { accountId: owner.id }, (client) =>
      createSite(client, { id: newUlid(), slug: `pub-${newUlid()}`, name: "Pub", ownerId: owner.id }),
    );

    const first = await withTenantContext(appPool, { siteId: site.id }, async (client) => {
      const publish = await createPublish(client, {
        id: newUlid(),
        siteId: site.id,
        bundlePath: "bundles/first",
        contentHash: "hash-1",
        createdBy: owner.id,
      });
      await setLivePublish(client, site.id, publish.id);
      return publish;
    });

    const second = await withTenantContext(appPool, { siteId: site.id }, async (client) => {
      const publish = await createPublish(client, {
        id: newUlid(),
        siteId: site.id,
        bundlePath: "bundles/second",
        contentHash: "hash-2",
        createdBy: owner.id,
      });
      await setLivePublish(client, site.id, publish.id);
      return publish;
    });

    const live = await withTenantContext(appPool, { siteId: site.id }, (client) => getLivePublish(client, site.id));
    expect(live?.id).toBe(second.id);

    // Rollback: repoint at the first publish (R5 — restore any previous publish, not just undo the last one).
    await withTenantContext(appPool, { siteId: site.id }, (client) => setLivePublish(client, site.id, first.id));
    const rolledBack = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      getLivePublish(client, site.id),
    );
    expect(rolledBack?.id).toBe(first.id);
  });
});
