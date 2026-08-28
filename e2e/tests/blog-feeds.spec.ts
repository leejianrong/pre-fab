import { test, expect } from "@playwright/test";
import { newUlid } from "@prefab/schema";
import { POSTDETAIL_BLOCK_TYPE, postDetailDefaultProps } from "@prefab/blocks";
import { API_URL, authenticatedContext } from "./helpers.js";

/** Fetches a path under the site's live bundle, following the `/live/*` redirect by hand (Playwright's `request` fixture does follow redirects, but the target route needs the same bearer auth `/live/*` itself requires). */
async function fetchLive(request: import("@playwright/test").APIRequestContext, siteId: string, token: string, subPath: string) {
  return request.get(`${API_URL}/v1/sites/${siteId}/live/${subPath}`, { headers: { authorization: `Bearer ${token}` } });
}

test("RSS validates and the sitemap lists every published post", async ({ request }) => {
  const { ctx, site, token } = await authenticatedContext("blog-feeds");

  const blogPage = await ctx.api.createPage(site.site.id, { slug: "blog", title: "Blog" });
  await ctx.api.writePage(site.site.id, blogPage.id, {
    title: "Blog",
    slug: "blog",
    blocks: [
      { id: newUlid(), type: POSTDETAIL_BLOCK_TYPE, parent: null, order: 1000, schemaVersion: 1, props: { ...postDetailDefaultProps }, responsive: {} },
    ],
    expectedVersion: blogPage.version,
  });

  const titles = ["First published post", "Second published post", "Third published post"];
  const slugs: string[] = [];
  for (const title of titles) {
    const created = await ctx.api.createPost(site.site.id, { title, date: "2024-01-01", status: "published" });
    slugs.push(created.slug);
  }

  await ctx.api.publish(site.site.id);

  const rss = await fetchLive(request, site.site.id, token, "rss.xml");
  expect(rss.status()).toBe(200);
  const rssBody = await rss.text();
  // "Validates" here means well-formed RSS 2.0: a single root <rss> element
  // with a <channel>, and one <item> per post with the fields a feed reader
  // needs (title, link, guid, pubDate).
  expect(rssBody).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?><rss version="2\.0">/);
  expect(rssBody).toContain("<channel>");
  expect((rssBody.match(/<item>/g) ?? []).length).toBe(titles.length);
  for (const title of titles) {
    expect(rssBody).toContain(`<title>${title}</title>`);
  }
  expect(rssBody).toContain("<pubDate>");
  expect(rssBody).toContain("<guid");

  const sitemap = await fetchLive(request, site.site.id, token, "sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const sitemapBody = await sitemap.text();
  expect(sitemapBody).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?><urlset/);
  for (const slug of slugs) {
    expect(sitemapBody).toContain(`blog/${slug}`);
  }
});

test("a scheduled or draft post is not reachable on the live site", async ({ request }) => {
  const { ctx, site, token } = await authenticatedContext("blog-visibility");

  const blogPage = await ctx.api.createPage(site.site.id, { slug: "blog", title: "Blog" });
  await ctx.api.writePage(site.site.id, blogPage.id, {
    title: "Blog",
    slug: "blog",
    blocks: [
      { id: newUlid(), type: POSTDETAIL_BLOCK_TYPE, parent: null, order: 1000, schemaVersion: 1, props: { ...postDetailDefaultProps }, responsive: {} },
    ],
    expectedVersion: blogPage.version,
  });

  const draft = await ctx.api.createPost(site.site.id, { title: "Draft post", date: "2024-01-01", status: "draft" });

  const farFuture = new Date();
  farFuture.setFullYear(farFuture.getFullYear() + 1);
  const scheduled = await ctx.api.createPost(site.site.id, {
    title: "Scheduled post",
    date: farFuture.toISOString().slice(0, 10),
    status: "published",
  });

  const published = await ctx.api.createPost(site.site.id, { title: "Published post", date: "2024-01-01", status: "published" });

  await ctx.api.publish(site.site.id);

  const draftResponse = await fetchLive(request, site.site.id, token, `blog/${draft.slug}/`);
  expect(draftResponse.status()).toBe(404);

  const scheduledResponse = await fetchLive(request, site.site.id, token, `blog/${scheduled.slug}/`);
  expect(scheduledResponse.status()).toBe(404);

  const publishedResponse = await fetchLive(request, site.site.id, token, `blog/${published.slug}/`);
  expect(publishedResponse.status()).toBe(200);

  const rss = await fetchLive(request, site.site.id, token, "rss.xml");
  const rssBody = await rss.text();
  expect(rssBody).not.toContain("Draft post");
  expect(rssBody).not.toContain("Scheduled post");
});
