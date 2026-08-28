/**
 * Runs one Astro build to completion and exits. Invoked as a standalone
 * subprocess by build.ts's `buildSiteBundle` — never imported directly by
 * anything long-lived (the API server, a test runner). That isolation is
 * deliberate: Astro's own internal Vite instance is sensitive to whatever
 * already sits in the calling process's module cache and `NODE_ENV`, and a
 * dev-mode React accidentally loaded earlier in a long-lived process (a
 * test runner's own Vite instance is exactly this) gets bundled against
 * react-dom's production server renderer — which is what throws
 * "dispatcher.getOwner is not a function". A fresh process has no such
 * history: NODE_ENV is set before anything else runs, full stop.
 *
 * Contract: argv[2] is a path to a JSON file with
 * `{ site, theme, pages, bundleStoreDir }` (SiteBuildData + bundleStoreDir).
 * On success, prints `{ bundlePath, contentHash }` as JSON to stdout and
 * exits 0. On failure, prints the error to stderr and exits 1.
 */
process.env.ASTRO_TELEMETRY_DISABLED = "1";
process.env.NODE_ENV = "production";

import { access, cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageDocument, PostDocument, SiteManifest, ThemeDocument } from "@prefab/schema";
import { createBuildWorkspace, ensureBundleStore } from "./workspace.js";
import { hashDirectory } from "./content-hash.js";
import { generateRssFeed, generateSitemap } from "./feeds.js";

interface WorkerInput {
  site: SiteManifest;
  theme: ThemeDocument;
  pages: PageDocument[];
  posts: PostDocument[];
  baseUrl: string;
  runtimeApiUrl: string;
  turnstileSiteKey: string;
  bundleStoreDir: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Newest-first, id as a stable tiebreaker for equal dates — the same order `listPostsForSite` already returns from Postgres, applied here too so pagination/RSS/sitemap order is a single, pipeline-owned invariant rather than something every caller (and every test fixture) has to get right on its own. */
function sortPostsNewestFirst(posts: PostDocument[]): PostDocument[] {
  return [...posts].sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("build-worker: missing input file path argument");
  const input: WorkerInput = JSON.parse(await readFile(inputPath, "utf8"));
  input.posts = sortPostsNewestFirst(input.posts);

  const { build: astroBuild } = await import("astro");
  const { default: react } = await import("@astrojs/react");

  const workspace = await createBuildWorkspace({
    site: input.site,
    theme: input.theme,
    pages: input.pages,
    posts: input.posts,
    runtimeApiUrl: input.runtimeApiUrl,
    turnstileSiteKey: input.turnstileSiteKey,
  });
  const previousCwd = process.cwd();
  // Some prerender-SSR artifacts are written relative to process.cwd()
  // regardless of the `root`/`outDir` passed below — see build.ts.
  process.chdir(workspace.root);
  try {
    await astroBuild({
      root: workspace.root,
      outDir: workspace.outDir,
      integrations: [react()],
      logLevel: "silent",
      devToolbar: { enabled: false },
      configFile: false,
      mode: "production",
    });

    // RSS/sitemap generation (SLICES.md Slice 5) — plain files written
    // straight into the static output, not Astro endpoints: no per-build
    // template interpolation needed, so this stays outside the one file
    // (page-template.ts) that owns Astro source generation.
    await writeFile(
      path.join(workspace.outDir, "rss.xml"),
      generateRssFeed({ site: input.site, pages: input.pages, posts: input.posts, baseUrl: input.baseUrl }),
      "utf8",
    );
    await writeFile(
      path.join(workspace.outDir, "sitemap.xml"),
      generateSitemap({ pages: input.pages, posts: input.posts, baseUrl: input.baseUrl }),
      "utf8",
    );

    const contentHash = await hashDirectory(workspace.outDir);
    await ensureBundleStore(input.bundleStoreDir);
    const bundlePath = path.join(input.bundleStoreDir, contentHash);

    if (!(await pathExists(bundlePath))) {
      await cp(workspace.outDir, bundlePath, { recursive: true });
    }

    process.stdout.write(JSON.stringify({ bundlePath, contentHash }));
  } finally {
    process.chdir(previousCwd);
    await workspace.cleanup();
  }
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
