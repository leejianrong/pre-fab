import { buildSiteBundle } from "@prefab/publish";
import type { SiteManifest, ThemeDocument } from "@prefab/schema";
import type { Command } from "../registry.js";
import { readCheckoutPages, readCheckoutPosts, readCheckoutSite, readCheckoutTheme } from "../checkout.js";

export interface BuildArgs {
  dir: string;
  bundleStoreDir: string;
}

export interface BuildResult {
  bundlePath: string;
  contentHash: string;
}

/**
 * Builds a local checkout with no network access at all (R16) — reads only
 * from disk and shells out to the same Astro pipeline `publish.create`
 * uses, so what this produces is exactly what would go live.
 */
export async function buildCheckout(args: BuildArgs): Promise<BuildResult> {
  const siteFile = await readCheckoutSite(args.dir);
  const themeFile = await readCheckoutTheme(args.dir);
  const pages = await readCheckoutPages(args.dir);
  const posts = await readCheckoutPosts(args.dir);

  const site: SiteManifest = {
    id: siteFile.id,
    slug: siteFile.slug,
    name: siteFile.name,
    ownerId: "local-checkout",
    schemaVersion: 1,
    pages: pages.map((p) => ({ id: p.id, slug: p.slug })),
  };
  const theme: ThemeDocument = {
    id: siteFile.id,
    siteId: siteFile.id,
    schemaVersion: themeFile.schemaVersion,
    tokens: themeFile.tokens,
  };

  return buildSiteBundle({ site, theme, pages, posts, bundleStoreDir: args.bundleStoreDir });
}

export const build: Command<BuildArgs, BuildResult> = {
  name: "build",
  description: "Build a local checkout to a static bundle — no network required (R16)",
  run: (_ctx, args) => buildCheckout(args),
};
