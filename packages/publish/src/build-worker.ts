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

import { access, cp, readFile } from "node:fs/promises";
import path from "node:path";
import type { PageDocument, SiteManifest, ThemeDocument } from "@prefab/schema";
import { createBuildWorkspace, ensureBundleStore } from "./workspace.js";
import { hashDirectory } from "./content-hash.js";

interface WorkerInput {
  site: SiteManifest;
  theme: ThemeDocument;
  pages: PageDocument[];
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

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("build-worker: missing input file path argument");
  const input: WorkerInput = JSON.parse(await readFile(inputPath, "utf8"));

  const { build: astroBuild } = await import("astro");
  const { default: react } = await import("@astrojs/react");

  const workspace = await createBuildWorkspace({ site: input.site, theme: input.theme, pages: input.pages });
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
