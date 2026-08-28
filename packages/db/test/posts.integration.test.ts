import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newUlid } from "@prefab/schema";
import { createPool, runMigrations, withTenantContext } from "../src/index.js";
import { createAccount, createSite } from "../src/repositories/index.js";
import { createPost, getPost, listAllPostsForSite, listPostsForSite, listPostSlugsForSite, writePost } from "../src/repositories/posts.js";

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

describe("posts under RLS (Slice 5)", () => {
  it("a post created for one site is invisible under another site's context", async () => {
    const { site: siteA } = await makeSite("posts-a");
    const { site: siteB } = await makeSite("posts-b");

    const post = await withTenantContext(appPool, { siteId: siteA.id }, (client) =>
      createPost(client, { id: newUlid(), siteId: siteA.id, slug: "hello", title: "Hello", date: "2024-01-01" }),
    );

    const fromB = await withTenantContext(appPool, { siteId: siteB.id }, (client) => getPost(client, post.id));
    expect(fromB).toBeNull();

    const fromA = await withTenantContext(appPool, { siteId: siteA.id }, (client) => getPost(client, post.id));
    expect(fromA?.id).toBe(post.id);
  });

  it("listAllPostsForSite under one site's context never returns another site's posts", async () => {
    const { site: siteA } = await makeSite("posts-list-a");
    const { site: siteB } = await makeSite("posts-list-b");

    await withTenantContext(appPool, { siteId: siteA.id }, (client) =>
      createPost(client, { id: newUlid(), siteId: siteA.id, slug: "a-post", title: "A post", date: "2024-01-01" }),
    );
    await withTenantContext(appPool, { siteId: siteB.id }, (client) =>
      createPost(client, { id: newUlid(), siteId: siteB.id, slug: "b-post", title: "B post", date: "2024-01-01" }),
    );

    const postsForA = await withTenantContext(appPool, { siteId: siteA.id }, (client) => listAllPostsForSite(client, siteA.id));
    expect(postsForA).toHaveLength(1);
    expect(postsForA[0]!.slug).toBe("a-post");
  });
});

describe("listPostsForSite pagination boundaries", () => {
  it("orders newest-first by date and paginates with a stable total", async () => {
    const { site } = await makeSite("pagination");
    const dates = ["2024-01-01", "2024-01-05", "2024-01-10", "2024-01-15", "2024-01-20"];
    for (const date of dates) {
      await withTenantContext(appPool, { siteId: site.id }, (client) =>
        createPost(client, { id: newUlid(), siteId: site.id, slug: `post-${date}`, title: `Post ${date}`, date }),
      );
    }

    const firstPage = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      listPostsForSite(client, site.id, { limit: 2, offset: 0 }),
    );
    expect(firstPage.total).toBe(5);
    expect(firstPage.posts.map((p) => p.date)).toEqual(["2024-01-20", "2024-01-15"]);

    const secondPage = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      listPostsForSite(client, site.id, { limit: 2, offset: 2 }),
    );
    expect(secondPage.posts.map((p) => p.date)).toEqual(["2024-01-10", "2024-01-05"]);

    const lastPage = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      listPostsForSite(client, site.id, { limit: 2, offset: 4 }),
    );
    expect(lastPage.posts.map((p) => p.date)).toEqual(["2024-01-01"]);
  });

  it("an offset past the end returns an empty page, not an error", async () => {
    const { site } = await makeSite("pagination-empty");
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createPost(client, { id: newUlid(), siteId: site.id, slug: "only-post", title: "Only post", date: "2024-01-01" }),
    );

    const page = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      listPostsForSite(client, site.id, { limit: 10, offset: 500 }),
    );
    expect(page.posts).toEqual([]);
    expect(page.total).toBe(1);
  });

  it("clamps an out-of-range limit rather than erroring or returning unbounded rows", async () => {
    const { site } = await makeSite("pagination-clamp");
    for (let i = 0; i < 3; i++) {
      await withTenantContext(appPool, { siteId: site.id }, (client) =>
        createPost(client, { id: newUlid(), siteId: site.id, slug: `clamp-${i}`, title: `Clamp ${i}`, date: "2024-01-01" }),
      );
    }

    const zeroLimit = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      listPostsForSite(client, site.id, { limit: 0 }),
    );
    expect(zeroLimit.posts).toHaveLength(1); // clamped up to the minimum of 1

    const hugeLimit = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      listPostsForSite(client, site.id, { limit: 10_000 }),
    );
    expect(hugeLimit.posts).toHaveLength(3); // clamped down to MAX_LIMIT, but there are only 3 rows anyway
  });

  it("filters by status when asked", async () => {
    const { site } = await makeSite("pagination-status");
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createPost(client, { id: newUlid(), siteId: site.id, slug: "draft-post", title: "Draft", date: "2024-01-01", status: "draft" }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createPost(client, { id: newUlid(), siteId: site.id, slug: "published-post", title: "Published", date: "2024-01-01", status: "published" }),
    );

    const published = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      listPostsForSite(client, site.id, { status: "published" }),
    );
    expect(published.posts.map((p) => p.slug)).toEqual(["published-post"]);
  });
});

describe("listPostSlugsForSite", () => {
  it("returns every slug on the site, for dedupe-checking a new one", async () => {
    const { site } = await makeSite("slugs");
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createPost(client, { id: newUlid(), siteId: site.id, slug: "first", title: "First", date: "2024-01-01" }),
    );
    await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createPost(client, { id: newUlid(), siteId: site.id, slug: "second", title: "Second", date: "2024-01-01" }),
    );

    const slugs = await withTenantContext(appPool, { siteId: site.id }, (client) => listPostSlugsForSite(client, site.id));
    expect(new Set(slugs)).toEqual(new Set(["first", "second"]));
  });
});

describe("writePost optimistic concurrency (ADR-0006/R17)", () => {
  it("rejects a stale write and leaves the prior write intact", async () => {
    const { site } = await makeSite("oc");
    const post = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createPost(client, { id: newUlid(), siteId: site.id, slug: "oc-post", title: "OC", date: "2024-01-01" }),
    );

    const firstWrite = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      writePost(client, {
        postId: post.id,
        siteId: site.id,
        slug: "oc-post",
        title: "First edit",
        date: "2024-01-01",
        author: "",
        tags: [],
        cover: null,
        body: "",
        locale: "en",
        status: "draft",
        expectedVersion: 0,
      }),
    );
    expect(firstWrite.ok).toBe(true);

    const staleWrite = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      writePost(client, {
        postId: post.id,
        siteId: site.id,
        slug: "oc-post",
        title: "Stale edit",
        date: "2024-01-01",
        author: "",
        tags: [],
        cover: null,
        body: "",
        locale: "en",
        status: "draft",
        expectedVersion: 0,
      }),
    );
    expect(staleWrite.ok).toBe(false);
    if (!staleWrite.ok) {
      expect(staleWrite.current.title).toBe("First edit");
      expect(staleWrite.current.version).toBe(1);
    }
  });

  it("re-applying identical content is a no-op that never bumps version", async () => {
    const { site } = await makeSite("oc-noop");
    const post = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      createPost(client, { id: newUlid(), siteId: site.id, slug: "noop-post", title: "Noop", date: "2024-01-01" }),
    );

    const result = await withTenantContext(appPool, { siteId: site.id }, (client) =>
      writePost(client, {
        postId: post.id,
        siteId: site.id,
        slug: post.slug,
        title: post.title,
        date: post.date,
        author: post.author,
        tags: post.tags,
        cover: post.cover,
        body: post.body,
        locale: post.locale,
        status: post.status,
        expectedVersion: 0,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.version).toBe(0);
  });
});
