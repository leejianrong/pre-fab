import type { PageDocument, PostDocument, SiteManifest } from "@prefab/schema";

const POSTDETAIL_BLOCK_TYPE = "postdetail";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** The first page (in document order) carrying a `postdetail` block — where an individual post's own URL lives, by convention `${page.slug}/${post.slug}`. */
function findPostDetailPage(pages: PageDocument[]): PageDocument | undefined {
  return pages.find((page) => page.blocks.some((block) => block.type === POSTDETAIL_BLOCK_TYPE));
}

function pageUrl(baseUrl: string, slug: string): string {
  return slug === "home" ? `${baseUrl}/` : `${baseUrl}/${slug}/`;
}

function postUrl(baseUrl: string, detailPage: PageDocument | undefined, post: PostDocument): string | undefined {
  if (!detailPage) return undefined;
  return `${baseUrl}/${detailPage.slug}/${post.slug}`;
}

/**
 * RSS 2.0 feed over exactly the posts it's handed — the caller (apps/api's
 * publish.create) has already filtered to publicly-visible posts (R "publish
 * includes only published posts"), so this never re-derives visibility.
 */
export function generateRssFeed(input: { site: SiteManifest; pages: PageDocument[]; posts: PostDocument[]; baseUrl: string }): string {
  const { site, pages, posts, baseUrl } = input;
  const detailPage = findPostDetailPage(pages);

  const items = posts
    .map((post) => {
      const link = postUrl(baseUrl, detailPage, post) ?? baseUrl;
      const pubDate = new Date(`${post.date}T00:00:00.000Z`).toUTCString();
      return `<item><title>${escapeXml(post.title)}</title><link>${escapeXml(link)}</link><guid isPermaLink="${
        detailPage ? "true" : "false"
      }">${escapeXml(link !== baseUrl ? link : post.id)}</guid><pubDate>${pubDate}</pubDate>${
        post.author ? `<author>${escapeXml(post.author)}</author>` : ""
      }</item>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(
    site.name,
  )}</title><link>${escapeXml(baseUrl)}</link><description>${escapeXml(`${site.name} blog`)}</description>${items}</channel></rss>`;
}

/** Sitemap over every page plus every visible post's own detail URL (when a detail page exists). */
export function generateSitemap(input: { pages: PageDocument[]; posts: PostDocument[]; baseUrl: string }): string {
  const { pages, posts, baseUrl } = input;
  const detailPage = findPostDetailPage(pages);

  const pageUrls = pages.map((page) => pageUrl(baseUrl, page.slug));
  const postUrls = detailPage ? posts.map((post) => `${postUrl(baseUrl, detailPage, post)}`) : [];

  const urlEntries = [...pageUrls, ...postUrls]
    .map((url) => `<url><loc>${escapeXml(url)}</loc></url>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urlEntries}</urlset>`;
}
