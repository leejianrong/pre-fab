/**
 * A single, fixed Astro page — never templated with per-build data. Every
 * publish writes a fresh `data.json` next to this file; the page itself
 * never changes, so there is no per-build string interpolation into Astro
 * source and therefore no injection surface for a block's or a theme's
 * content.
 *
 * Blocks render through the exact same @prefab/blocks components the Puck
 * canvas uses (via @prefab/puck-adapter) — no `client:*` directive, since
 * Hero needs no hydration (ADR-0007: static blocks ship 0 KB). This file,
 * plus @prefab/publish, is the only place in the repo allowed to import
 * Astro (enforced by tools/checks).
 */
export const SITE_PAGE_ASTRO = `---
import data from "../data.json";
import { blockComponents, resolveThemeTokens, themeRootStyle } from "@prefab/blocks";

export function getStaticPaths() {
  return data.pages.map((page) => ({
    params: { slug: page.slug === "home" ? undefined : page.slug },
    props: { page, theme: data.theme, site: data.site },
  }));
}

const { page, theme, site } = Astro.props;
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
      return Component ? <Component {...block.props} blockId={block.id} responsive={block.responsive} /> : null;
    })}
  </body>
</html>
`;
