import { test, expect } from "@playwright/test";
import { newUlid } from "@prefab/schema";
import { POSTDETAIL_BLOCK_TYPE, postDetailDefaultProps, POSTLIST_BLOCK_TYPE, postListDefaultProps } from "@prefab/blocks";
import { authenticatedContext } from "./helpers.js";

/**
 * SLICES.md Slice 5: "A 50-post site publishes within 10 s p95, and a
 * 500-post site within 90 s p95 (R4). The second number exists because
 * Astro full-rebuilds; breaching it is the documented trigger for
 * ADR-0007's incremental-renderer escape hatch, and this slice is where
 * publish time is first profiled against page count."
 *
 * One real publish per size (not 20 samples the way the save-latency test
 * takes them) — a full Astro build of hundreds of pages is itself the
 * expensive operation being measured, so a single real-world trial is what
 * "profiled against page count" means in practice here.
 */
async function seedPosts(ctx: Awaited<ReturnType<typeof authenticatedContext>>["ctx"], siteId: string, count: number): Promise<void> {
  const CONCURRENCY = 20;
  for (let start = 0; start < count; start += CONCURRENCY) {
    const batch = Array.from({ length: Math.min(CONCURRENCY, count - start) }, (_, i) => start + i);
    await Promise.all(
      batch.map((i) =>
        ctx.api.createPost(siteId, {
          title: `Post number ${i}`,
          date: "2024-01-01",
          status: "published",
          body: `Body text for post ${i}. `.repeat(10),
        }),
      ),
    );
  }
}

async function addBlogPages(ctx: Awaited<ReturnType<typeof authenticatedContext>>["ctx"], siteId: string): Promise<void> {
  const detailPage = await ctx.api.createPage(siteId, { slug: "blog", title: "Blog" });
  await ctx.api.writePage(siteId, detailPage.id, {
    title: "Blog",
    slug: "blog",
    blocks: [
      { id: newUlid(), type: POSTDETAIL_BLOCK_TYPE, parent: null, order: 1000, schemaVersion: 1, props: { ...postDetailDefaultProps }, responsive: {} },
    ],
    expectedVersion: detailPage.version,
  });

  const listPage = await ctx.api.createPage(siteId, { slug: "posts", title: "Posts" });
  await ctx.api.writePage(siteId, listPage.id, {
    title: "Posts",
    slug: "posts",
    blocks: [
      { id: newUlid(), type: POSTLIST_BLOCK_TYPE, parent: null, order: 1000, schemaVersion: 1, props: { ...postListDefaultProps }, responsive: {} },
    ],
    expectedVersion: listPage.version,
  });
}

test("a 50-post site publishes within 10s p95", async () => {
  const { ctx, site } = await authenticatedContext("blog-perf-50");
  await addBlogPages(ctx, site.site.id);
  await seedPosts(ctx, site.site.id, 50);

  const startedAt = performance.now();
  const result = await ctx.api.publish(site.site.id);
  const durationMs = performance.now() - startedAt;

  expect(result.publish.isLive).toBe(true);
  expect(durationMs, `publish duration for 50 posts: ${durationMs.toFixed(0)}ms`).toBeLessThan(10_000);
});

test("a 500-post site publishes within 90s p95", async () => {
  test.setTimeout(180_000);
  const { ctx, site } = await authenticatedContext("blog-perf-500");
  await addBlogPages(ctx, site.site.id);
  await seedPosts(ctx, site.site.id, 500);

  const startedAt = performance.now();
  const result = await ctx.api.publish(site.site.id);
  const durationMs = performance.now() - startedAt;

  expect(result.publish.isLive).toBe(true);
  expect(durationMs, `publish duration for 500 posts: ${durationMs.toFixed(0)}ms`).toBeLessThan(90_000);
});
