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
 * block (Slice 6), the Booking block (Slice 9), the EventSignup block
 * (KAN-1138) and the Payment block (Slice 10 / KAN-1137) are the
 * exceptions: they're the runtime API's callers, so they alone render with
 * `client:load`. That hydration needs a *statically* importable component —
 * Astro's compiler resolves a client directive's island by generating a
 * client-side import for whatever identifier the JSX tag names, and
 * `blockComponents[block.type]` (a runtime lookup into a plain object) has
 * no such static import to point at, so it fails with "No matching import
 * has been found" for any dynamically-resolved component. `Form`,
 * `Booking`, `EventSignup` and `Payment` are imported directly below for
 * exactly this reason, and rendered on their own branch rather than
 * through `blockComponents`. This file, plus @prefab/publish, is the only
 * place in the repo allowed to import Astro (enforced by tools/checks).
 *
 * ADR-0014 (KAN-1129): a `"free"` page's root-level blocks each carry a
 * `position` instead of relying on document flow. `freePositionBaseStyle`/
 * `FreePositionStyle`/`rankRootBlocksForStacking` (@prefab/blocks/
 * free-position.tsx) are the CSS-emission half of that, mirroring how
 * `ResponsiveStyle` already works — but unlike `ResponsiveStyle`, nothing
 * about any individual block component changes: this file wraps each
 * root-level block's already-rendered markup in a positioned container
 * itself, in the one rendering loop below, so free positioning never
 * touches the ~30 existing block files. A `"flow"` page (the default, every
 * existing site) takes the untouched branch and renders byte-identically to
 * before this feature existed.
 *
 * ADR-0015 (KAN-1152): `scrollReveal` is passed to every block the same
 * uniform way `responsive` already is, and `ScrollRevealAssets` is rendered
 * once, gated on whether any block on this page actually opted in
 * (`pageNeedsScrollRevealAssets`) — a page with nothing opted in emits no
 * extra CSS/JS at all, so this feature is invisible to every existing
 * template/site until a block explicitly turns it on.
 */
export const SITE_PAGE_ASTRO = `---
import data from "../data.json";
import {
  blockComponents,
  resolveThemeTokens,
  themeRootStyle,
  Form,
  Booking,
  EventSignup,
  Payment,
  FreePositionStyle,
  freePositionBaseStyle,
  rankRootBlocksForStacking,
  freeCanvasRootStyle,
  ScrollRevealAssets,
  pageNeedsScrollRevealAssets,
} from "@prefab/blocks";

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
    <ScrollRevealAssets anyRevealed={pageNeedsScrollRevealAssets(page.blocks)} />
    {(() => {
      // ADR-0014: everything below this line, up to \`rendered\`, is
      // identical in shape to what this loop did before free positioning
      // existed — \`renderBlockInner\` is that same per-block branch,
      // factored out only so \`wrapIfFree\` can sit around it. When
      // \`page.layoutMode\` isn't \`"free"\` (every page before this feature,
      // and every page that hasn't opted in), \`wrapIfFree\` is a no-op and
      // \`rendered\` is returned exactly as \`page.blocks.map(renderBlockInner)\`
      // would be on its own, so a "flow" page's output is byte-identical to
      // before this feature existed.
      const isFreeLayout = page.layoutMode === "free";
      const freeZIndexByBlockId = isFreeLayout ? rankRootBlocksForStacking(page.blocks) : new Map();

      function renderBlockInner(block) {
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
              scrollReveal={block.scrollReveal}
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
              scrollReveal={block.scrollReveal}
              runtimeApiUrl={data.runtimeApiUrl}
            />
          );
        }

        if (block.type === "eventsignup") {
          return (
            <EventSignup
              client:load
              {...block.props}
              blockId={block.id}
              responsive={block.responsive}
              scrollReveal={block.scrollReveal}
              runtimeApiUrl={data.runtimeApiUrl}
            />
          );
        }

        if (block.type === "payment") {
          return (
            <Payment
              client:load
              {...block.props}
              blockId={block.id}
              responsive={block.responsive}
              scrollReveal={block.scrollReveal}
              runtimeApiUrl={data.runtimeApiUrl}
            />
          );
        }

        return (
          <Component {...block.props} {...extraProps} blockId={block.id} responsive={block.responsive} scrollReveal={block.scrollReveal} />
        );
      }

      // Root-level blocks only (ADR-0014's scope exactly) — a block with a
      // non-null \`parent\` never gets a positioned wrapper, free page or not
      // (there are no nested non-root blocks in production today, but this
      // guard is what keeps that true if one ever shows up). \`element ===
      // null\` (an unknown block type) also passes through untouched: no
      // positioning container around markup that isn't there.
      function wrapIfFree(block, element) {
        if (!isFreeLayout || element === null || block.parent !== null || !block.position) return element;
        const style = freePositionBaseStyle(block.position.base, freeZIndexByBlockId.get(block.id));
        return (
          <div style={style} data-pf-free-block-id={block.id}>
            <FreePositionStyle blockId={block.id} position={block.position} />
            {element}
          </div>
        );
      }

      const rendered = page.blocks.map((block) => wrapIfFree(block, renderBlockInner(block)));

      if (!isFreeLayout) return rendered;

      // The positioned canvas root every wrapped block's percentage
      // \`left\`/\`top\`/\`width\`/\`height\` resolves against (ADR-0014's
      // Consequences: "its own Astro render path... on a positioned canvas
      // root") — see \`freeCanvasRootStyle\`'s own comment for why it needs
      // an explicit minHeight, not just position:relative.
      return (
        <div style={freeCanvasRootStyle()} data-pf-free-canvas-root="">
          {rendered}
        </div>
      );
    })()}
  </body>
</html>
`;
