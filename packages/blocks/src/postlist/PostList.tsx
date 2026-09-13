import type { CSSProperties } from "react";
import type { PostDocument } from "@prefab/schema";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import { plainTextExcerpt } from "../markdown-lite.js";
import type { PostListProps } from "./schema.js";

export type PostListEntry = Pick<PostDocument, "id" | "slug" | "title" | "date" | "author" | "tags" | "body">;

/**
 * Injected by the publish pipeline's route expansion (@prefab/publish's
 * page-template.ts) — never part of the block's own stored props, the same
 * way `blockId`/`responsive` are injected rather than authored. Inside the
 * Puck canvas, none of these are supplied (there is no posts data source in
 * the editor canvas), so the block renders its empty state there.
 */
export interface PostListRenderProps {
  posts?: PostListEntry[];
  pageNumber?: number;
  totalPages?: number;
  /** This list page's own slug. Anchors *this block's* pagination routes (`${basePath}/page/N`) and nothing else. */
  basePath?: string;
  /**
   * KAN-1271: the slug of the page carrying the site's `postdetail` block
   * — where an individual post's route actually lives. It is never this
   * list page's own slug: `pages(site_id, slug)` is UNIQUE, so a list page
   * and a detail page cannot share one, which is exactly why deriving an
   * item's href from `basePath` (as this block did until KAN-1271) could
   * never resolve. `null`/absent means the site has no postdetail page at
   * all, so no per-post route exists and titles render as plain text
   * rather than as links that could only 404.
   */
  detailBasePath?: string | null;
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function PostList(props: PostListProps & BlockRenderProps & PostListRenderProps) {
  // postsPerPage isn't read here: the caller (@prefab/publish's
  // page-template.ts) already slices `posts` to the right page before this
  // renders — it only exists as a stored prop so getStaticPaths can compute
  // pagination from it.
  const { heading, showExcerpt, blockId, responsive, posts, pageNumber = 1, totalPages = 1, basePath = "", detailBasePath } = props;

  const sectionStyle: CSSProperties = {
    padding: `${cssVar("spacing", "section")} ${cssVar("spacing", "element")}`,
  };
  const headingStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "heading"),
    lineHeight: cssVar("lineHeight", "heading"),
    margin: `0 0 ${cssVar("spacing", "element")}`,
  };
  const listStyle: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: cssVar("spacing", "element") };
  const titleStyle: CSSProperties = { fontSize: cssVar("fontSize", "lg"), lineHeight: cssVar("lineHeight", "lg"), color: cssVar("color", "foreground") };
  const metaStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "sm"),
    lineHeight: cssVar("lineHeight", "sm"),
    color: cssVar("color", "foreground"),
    opacity: 0.7,
  };
  const excerptStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "body"),
    lineHeight: cssVar("lineHeight", "body"),
    color: cssVar("color", "foreground"),
  };
  const paginationStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    marginTop: cssVar("spacing", "element"),
  };
  const paginationLinkStyle: CSSProperties = { color: cssVar("color", "accent") };

  const prevHref = pageNumber > 1 ? (pageNumber - 1 === 1 ? `/${basePath}` : `/${basePath}/page/${pageNumber - 1}`) : null;
  const nextHref = pageNumber < totalPages ? `/${basePath}/page/${pageNumber + 1}` : null;

  /** KAN-1271/KAN-1262: the post's real permalink, under the *detail* page's slug, trailing-slashed to match the directory-format route the publish pipeline actually emits (and the RSS/sitemap permalink for the same post). `null` when no detail page exists. */
  function postHref(slug: string): string | null {
    return detailBasePath ? `/${detailBasePath}/${slug}/` : null;
  }

  return (
    <section className="pf-block pf-postlist" style={sectionStyle} data-pf-block-type="postlist" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      {heading ? (
        <h2 className="pf-postlist-heading" style={headingStyle}>
          {heading}
        </h2>
      ) : null}
      {!posts || posts.length === 0 ? (
        <p className="pf-postlist-empty" style={excerptStyle}>
          No posts yet.
        </p>
      ) : (
        <>
          <ul className="pf-postlist-items" style={listStyle}>
            {posts.map((post) => {
              const href = postHref(post.slug);
              return (
              <li key={post.id} className="pf-postlist-item">
                {href ? (
                  <a className="pf-postlist-item-title" href={href} style={{ ...titleStyle, textDecoration: "none" }}>
                    {post.title}
                  </a>
                ) : (
                  <span className="pf-postlist-item-title" style={titleStyle}>
                    {post.title}
                  </span>
                )}
                <div className="pf-postlist-item-meta" style={metaStyle}>
                  <time dateTime={post.date}>{formatDate(post.date)}</time>
                  {post.author ? <span> · {post.author}</span> : null}
                  {post.tags.length > 0 ? <span> · {post.tags.join(", ")}</span> : null}
                </div>
                {showExcerpt ? (
                  <p className="pf-postlist-item-excerpt" style={excerptStyle}>
                    {plainTextExcerpt(post.body)}
                  </p>
                ) : null}
              </li>
              );
            })}
          </ul>
          {totalPages > 1 ? (
            <nav className="pf-postlist-pagination" style={paginationStyle} aria-label="Pagination">
              {prevHref ? (
                <a href={prevHref} style={paginationLinkStyle}>
                  ← Newer
                </a>
              ) : (
                <span />
              )}
              {nextHref ? (
                <a href={nextHref} style={paginationLinkStyle}>
                  Older →
                </a>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
