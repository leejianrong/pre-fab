/**
 * A single, fixed Astro page — never templated with per-build data. Every
 * publish writes a fresh `data.json` next to this file; the page itself
 * never changes, so there is no per-build string interpolation into Astro
 * source and therefore no injection surface for a block's or a theme's
 * content.
 *
 * Blocks render through the exact same @prefab/blocks components the Puck
 * canvas uses (via @prefab/puck-adapter) — no `client:*` directive for
 * almost every block, since a static block ships 0 KB (ADR-0007). The Form
 * block (Slice 6) and the Booking block (Slice 9) are the exceptions:
 * they're the runtime API's callers, so they alone render with
 * `client:load`. That hydration needs a *statically* importable component —
 * Astro's compiler resolves a client directive's island by generating a
 * client-side import for whatever identifier the JSX tag names, and
 * `blockComponents[block.type]` (a runtime lookup into a plain object) has
 * no such static import to point at, so it fails with "No matching import
 * has been found" for any dynamically-resolved component. `Form` and
 * `Booking` are imported directly below for exactly this reason, and
 * rendered on their own branch rather than through `blockComponents`. This
 * file, plus @prefab/publish, is the only place in the repo allowed to
 * import Astro (enforced by tools/checks).
 */
export const SITE_PAGE_ASTRO = `---
import data from "../data.json";
import { blockComponents, resolveThemeTokens, themeRootStyle, Form, Booking } from "@prefab/blocks";

// SLICES.md Slice 5: "list and detail block types with pagination." A page
// carrying a postdetail block is a *template* for one route per post
// (\${page.slug}/\${post.slug}); a page carrying a postlist block gets one
// route per pagination page (page.slug, then \${page.slug}/page/2, ...).
// Everything else is the plain one-route-per-page mapping slice 1 already
// had. data.posts is exactly the set the caller decided to build with
// (already visibility-filtered for a real publish, unfiltered for an
// author's own preview) — this file never re-derives that decision.
//
// Every helper and constant this needs is declared *inside* this function,
// not as a sibling top-level declaration: Astro's static-build compiler
// extracts getStaticPaths into its own chunk for prerendering, and anything
// only reachable from it via a sibling reference is not reliably carried
// along into that extraction (observed as a ReferenceError at build time
// for both a helper function and a top-level const) — nesting is what
// makes the closure itself carry everything along.
export function getStaticPaths() {
  const POSTLIST_TYPE = "postlist";
  const POSTDETAIL_TYPE = "postdetail";

  function findBlockOfType(blocks, type) {
    return blocks.find((b) => b.type === type) ?? null;
  }

  function routeSlug(slug) {
    return slug === "home" ? undefined : slug;
  }

  const paths = [];

  for (const page of data.pages) {
    const detailBlock = findBlockOfType(page.blocks, POSTDETAIL_TYPE);
    if (detailBlock) {
      for (const post of data.posts) {
        paths.push({
          params: { slug: \`\${page.slug}/\${post.slug}\` },
          props: { page, theme: data.theme, site: data.site, detailPost: post },
        });
      }
      continue;
    }

    const listBlock = findBlockOfType(page.blocks, POSTLIST_TYPE);
    if (listBlock) {
      const postsPerPage = listBlock.props?.postsPerPage ?? 10;
      const totalPages = Math.max(1, Math.ceil(data.posts.length / postsPerPage));
      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
        const slug = pageNumber === 1 ? routeSlug(page.slug) : \`\${page.slug}/page/\${pageNumber}\`;
        paths.push({
          params: { slug },
          props: {
            page,
            theme: data.theme,
            site: data.site,
            listBlockId: listBlock.id,
            listPageNumber: pageNumber,
            listTotalPages: totalPages,
          },
        });
      }
      continue;
    }

    paths.push({
      params: { slug: routeSlug(page.slug) },
      props: { page, theme: data.theme, site: data.site },
    });
  }

  return paths;
}

const { page, theme, site, detailPost, listBlockId, listPageNumber, listTotalPages } = Astro.props;
const themeVars = themeRootStyle(resolveThemeTokens(theme.tokens));
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{page.title} · {site.name}</title>
  </head>
  <body style={themeVars} data-pf-site={site.id} data-pf-page={page.id}>
    {page.blocks.map((block) => {
      const Component = blockComponents[block.type];
      // R19: a block type unknown to this build is preserved in the
      // document and shown as a placeholder in the editor, but skipped
      // here rather than crashing the whole page's publish.
      if (!Component) return null;

      let extraProps = {};
      if (block.type === "postdetail" && detailPost) {
        extraProps = { post: detailPost };
      } else if (block.type === "postlist" && block.id === listBlockId) {
        const postsPerPage = block.props?.postsPerPage ?? 10;
        const start = (listPageNumber - 1) * postsPerPage;
        extraProps = {
          posts: data.posts.slice(start, start + postsPerPage),
          pageNumber: listPageNumber,
          totalPages: listTotalPages,
          basePath: page.slug,
        };
      }

      if (block.type === "form") {
        return (
          <Form
            client:load
            {...block.props}
            blockId={block.id}
            responsive={block.responsive}
            runtimeApiUrl={data.runtimeApiUrl}
            turnstileSiteKey={data.turnstileSiteKey}
          />
        );
      }

      if (block.type === "booking") {
        return (
          <Booking
            client:load
            {...block.props}
            blockId={block.id}
            responsive={block.responsive}
            runtimeApiUrl={data.runtimeApiUrl}
          />
        );
      }

      return <Component {...block.props} {...extraProps} blockId={block.id} responsive={block.responsive} />;
    })}
  </body>
</html>
`;
