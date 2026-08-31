import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSiteBundle } from "@prefab/publish";
import { buildExportManifest, type ExportManifest } from "@prefab/schema";
import type { Command } from "../registry.js";

/** Every post on the site, unpaginated — same reasoning as pull.ts's own `allPosts`: export needs the whole collection. */
async function allPosts(ctx: Parameters<Command<ExportBundleArgs, ExportBundleResult>["run"]>[0], siteId: string) {
  const all: Awaited<ReturnType<typeof ctx.api.listPosts>>["posts"] = [];
  let offset = 0;
  for (;;) {
    const page = await ctx.api.listPosts(siteId, { limit: 100, offset });
    all.push(...page.posts);
    offset += page.posts.length;
    if (page.posts.length === 0 || all.length >= page.total) break;
  }
  return all;
}

export interface ExportBundleArgs {
  siteId: string;
  /** Where the self-contained static output (plus manifest.json) lands. */
  outDir: string;
  /** Internal content-addressed scratch store the build pipeline writes through — never the caller's own outDir. */
  bundleStoreDir: string;
  /**
   * Where the exported bundle's Form island(s) will post submissions —
   * i.e. wherever this export is going to be served from (apps/self-host,
   * typically). Defaults to apps/self-host's own documented default
   * origin; re-export with the real value once one is known (a custom
   * domain, a production host) the same way RUNTIME_API_URL is configured
   * for the hosted platform (.env.example).
   */
  runtimeApiUrl?: string;
  baseUrl?: string;
  turnstileSiteKey?: string;
}

export interface ExportBundleResult {
  outDir: string;
  contentHash: string;
  manifest: ExportManifest;
}

/**
 * Export tier (a) (ADR-0010): the published output plus a manifest
 * declaring the schema version it was built from and how far back an
 * import can still be accepted from (R7 — free, no gate, no delay, on
 * every plan). Reuses the exact same `buildSiteBundle` pipeline every
 * hosted publish goes through, so what's exported is what would have gone
 * live — never a separate rendering path (R9's fidelity claim would be
 * meaningless otherwise).
 */
async function runExportBundle(
  ctx: Parameters<Command<ExportBundleArgs, ExportBundleResult>["run"]>[0],
  args: ExportBundleArgs,
): Promise<ExportBundleResult> {
  const site = await ctx.api.getSite(args.siteId);
  const theme = await ctx.api.getTheme(args.siteId);
  const pageRefs = await ctx.api.listPages(args.siteId);
  const pages = await Promise.all(pageRefs.map((p) => ctx.api.getPage(args.siteId, p.id)));
  const posts = await allPosts(ctx, args.siteId);
  // Slice 9 (R10): the site's availability rule, carried into the bundle
  // so a self-hosted instance can seed local slot computation with no
  // separate step — see build-worker.ts's own comment.
  const availabilityRule = await ctx.api.getAvailability(args.siteId);

  const siteManifest = {
    id: site.id,
    slug: site.slug,
    name: site.name,
    ownerId: site.ownerId,
    schemaVersion: site.schemaVersion,
    pages: pageRefs.map((p) => ({ id: p.id, slug: p.slug })),
  };

  const built = await buildSiteBundle({
    site: siteManifest,
    theme,
    pages,
    posts,
    baseUrl: args.baseUrl,
    runtimeApiUrl: args.runtimeApiUrl ?? "http://localhost:8080",
    turnstileSiteKey: args.turnstileSiteKey,
    availabilityRule: availabilityRule ? { ...availabilityRule, siteId: site.id } : null,
    bundleStoreDir: args.bundleStoreDir,
  });

  await mkdir(args.outDir, { recursive: true });
  await cp(built.bundlePath, args.outDir, { recursive: true });

  const exportManifest = buildExportManifest({ schemaVersion: site.schemaVersion });
  await writeFile(path.join(args.outDir, "manifest.json"), `${JSON.stringify(exportManifest, null, 2)}\n`, "utf8");

  return { outDir: args.outDir, contentHash: built.contentHash, manifest: exportManifest };
}

export const exportBundle: Command<ExportBundleArgs, ExportBundleResult> = {
  name: "export-bundle",
  description: "Export tier (a) (ADR-0010): a self-contained static bundle plus an import manifest — free, on every plan (R7)",
  run: runExportBundle,
};
