import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newUlid, DEFAULT_THEME_TOKENS, type PostDocument } from "@prefab/schema";
import { POSTLIST_BLOCK_TYPE, postListDefaultProps, POSTDETAIL_BLOCK_TYPE, postDetailDefaultProps } from "@prefab/blocks";
import { buildSiteBundle } from "../src/build.js";

let bundleStoreDir: string;

afterEach(async () => {
  if (bundleStoreDir) await rm(bundleStoreDir, { recursive: true, force: true });
});

function post(overrides: Partial<PostDocument>): PostDocument {
  return {
    id: newUlid(),
    siteId: "site",
    slug: overrides.slug ?? "post",
    title: overrides.title ?? "A post",
    schemaVersion: 1,
    version: 0,
    date: overrides.date ?? "2024-01-01",
    author: overrides.author ?? "Jane Doe",
    tags: overrides.tags ?? [],
    cover: overrides.cover ?? null,
    body: overrides.body ?? "Body text.",
    locale: "en",
    status: overrides.status ?? "published",
    ...overrides,
  };
}

/**
 * KAN-1271: the list page and the detail page have DIFFERENT slugs, which
 * is the only shape a real site can have — `pages(site_id, slug)` is
 * UNIQUE (0001_init.sql), so the two pages cannot share one. This fixture
 * used to give both the slug "blog", which is exactly why the broken
 * list->detail links this file now asserts on went unnoticed for two
 * milestones: with identical slugs the bug is invisible.
 */
const LIST_SLUG = "blog";
const DETAIL_SLUG = "post";

function blogSite(posts: PostDocument[], postsPerPage = 10) {
  const siteId = newUlid();
  const listPageId = newUlid();
  const detailPageId = newUlid();
  return {
    site: {
      id: siteId,
      slug: "demo",
      name: "Demo Blog",
      ownerId: newUlid(),
      schemaVersion: 1,
      pages: [
        { id: listPageId, slug: LIST_SLUG },
        { id: detailPageId, slug: DETAIL_SLUG },
      ],
    },
    theme: { id: newUlid(), siteId, schemaVersion: 1, tokens: DEFAULT_THEME_TOKENS },
    pages: [
      {
        id: listPageId,
        siteId,
        slug: LIST_SLUG,
        title: "Blog",
        schemaVersion: 1,
        version: 0,
        blocks: [
          {
            id: newUlid(),
            type: POSTLIST_BLOCK_TYPE,
            parent: null,
            order: 1000,
            schemaVersion: 1,
            props: { ...postListDefaultProps, postsPerPage },
            responsive: {},
          },
        ],
      },
      {
        id: detailPageId,
        siteId,
        slug: DETAIL_SLUG,
        title: "Blog post",
        schemaVersion: 1,
        version: 0,
        blocks: [
          { id: newUlid(), type: POSTDETAIL_BLOCK_TYPE, parent: null, order: 1000, schemaVersion: 1, props: { ...postDetailDefaultProps }, responsive: {} },
        ],
      },
    ],
    posts,
  };
}

describe("blog publish (Slice 5): list/detail routing, RSS, sitemap", () => {
  it("generates a detail route per post and a list route with pagination", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-blog-"));
    const posts = [
      post({ slug: "first-post", title: "First post", date: "2024-01-01" }),
      post({ slug: "second-post", title: "Second post", date: "2024-01-02" }),
      post({ slug: "third-post", title: "Third post", date: "2024-01-03" }),
    ];
    const { site, theme, pages } = blogSite(posts, 2);

    const result = await buildSiteBundle({ site, theme, pages, posts, baseUrl: "https://demo.prefab.app", bundleStoreDir });

    const firstDetailHtml = await readFile(path.join(result.bundlePath, DETAIL_SLUG, "first-post", "index.html"), "utf8");
    expect(firstDetailHtml).toContain("First post");
    expect(firstDetailHtml).toContain('data-pf-block-type="postdetail"');

    const listPage1 = await readFile(path.join(result.bundlePath, LIST_SLUG, "index.html"), "utf8");
    // Newest-first, 2 per page: page 1 has the two newest posts.
    expect(listPage1).toContain("Third post");
    expect(listPage1).toContain("Second post");
    expect(listPage1).not.toContain("First post");
    expect(listPage1).toContain("pf-postlist-pagination");

    const listPage2 = await readFile(path.join(result.bundlePath, LIST_SLUG, "page", "2", "index.html"), "utf8");
    expect(listPage2).toContain("First post");
  }, 60_000);

  // KAN-1271: the regression test that would have caught this. Every link
  // the list page emits for a post has to point at a route the very same
  // build actually wrote to disk — asserted by resolving each href against
  // the bundle directory, rather than by restating the expected URL shape a
  // second time (which is how the link and the route drifted apart in the
  // first place).
  it("emits post links that resolve to the detail page's real routes, not the list page's own slug", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-blog-links-"));
    const posts = [
      post({ slug: "first-post", title: "First post", date: "2024-01-01" }),
      post({ slug: "second-post", title: "Second post", date: "2024-01-02" }),
    ];
    const { site, theme, pages } = blogSite(posts);

    const result = await buildSiteBundle({ site, theme, pages, posts, baseUrl: "https://demo.prefab.app", bundleStoreDir });

    const listHtml = await readFile(path.join(result.bundlePath, LIST_SLUG, "index.html"), "utf8");
    const hrefs = [...listHtml.matchAll(/class="pf-postlist-item-title"\s+href="([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs).toEqual(expect.arrayContaining([`/${DETAIL_SLUG}/first-post/`, `/${DETAIL_SLUG}/second-post/`]));
    // Never the list page's own slug — the bug this test exists for.
    expect(listHtml).not.toContain(`href="/${LIST_SLUG}/first-post`);

    for (const href of hrefs) {
      const onDisk = path.join(result.bundlePath, href.replace(/^\//, ""), "index.html");
      await expect(readFile(onDisk, "utf8")).resolves.toContain('data-pf-block-type="postdetail"');
    }
  }, 60_000);

  it("builds correctly with zero posts (empty list, no detail routes)", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-blog-empty-"));
    const { site, theme, pages } = blogSite([]);

    const result = await buildSiteBundle({ site, theme, pages, posts: [], baseUrl: "https://demo.prefab.app", bundleStoreDir });
    const listHtml = await readFile(path.join(result.bundlePath, LIST_SLUG, "index.html"), "utf8");
    expect(listHtml).toContain("No posts yet");
  }, 60_000);

  it("only ever routes/feeds the posts it was handed — visibility filtering is the caller's job, not this pipeline's", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-blog-filtered-"));
    const visiblePost = post({ slug: "visible", title: "Visible post", status: "published", date: "2024-01-01" });
    // A draft/scheduled post the caller decided NOT to pass in at all —
    // simulating apps/api's publish.create filtering before this call.
    const { site, theme, pages } = blogSite([visiblePost]);

    const result = await buildSiteBundle({ site, theme, pages, posts: [visiblePost], baseUrl: "https://demo.prefab.app", bundleStoreDir });

    const listHtml = await readFile(path.join(result.bundlePath, LIST_SLUG, "index.html"), "utf8");
    expect(listHtml).toContain("Visible post");

    const rss = await readFile(path.join(result.bundlePath, "rss.xml"), "utf8");
    expect(rss).toContain("Visible post");
    expect((rss.match(/<item>/g) ?? []).length).toBe(1);
  }, 60_000);

  it("generates a valid-shaped RSS feed and a sitemap listing every post and page", async () => {
    bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-bundles-blog-feeds-"));
    const posts = [post({ slug: "one", title: "One" }), post({ slug: "two", title: "Two" })];
    const { site, theme, pages } = blogSite(posts);

    const result = await buildSiteBundle({ site, theme, pages, posts, baseUrl: "https://demo.prefab.app", bundleStoreDir });

    const rss = await readFile(path.join(result.bundlePath, "rss.xml"), "utf8");
    expect(rss).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(rss).toContain("<rss version=\"2.0\">");
    expect(rss).toContain("<title>One</title>");
    expect(rss).toContain("<title>Two</title>");
    // KAN-1262: a post permalink is trailing-slashed, exactly like a page
    // URL already was — the directory-format route Astro actually writes.
    expect(rss).toContain(`<link>https://demo.prefab.app/${DETAIL_SLUG}/one/</link>`);
    expect(rss).toContain(`<link>https://demo.prefab.app/${DETAIL_SLUG}/two/</link>`);

    const sitemap = await readFile(path.join(result.bundlePath, "sitemap.xml"), "utf8");
    expect(sitemap).toContain("<urlset");
    expect(sitemap).toContain(`<loc>https://demo.prefab.app/${DETAIL_SLUG}/one/</loc>`);
    expect(sitemap).toContain(`<loc>https://demo.prefab.app/${DETAIL_SLUG}/two/</loc>`);
    expect(sitemap).toContain(`<loc>https://demo.prefab.app/${LIST_SLUG}/</loc>`);
  }, 60_000);
});
