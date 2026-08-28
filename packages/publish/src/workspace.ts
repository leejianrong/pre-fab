import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PageDocument, PostDocument, SiteManifest, ThemeDocument } from "@prefab/schema";
import { SITE_PAGE_ASTRO } from "./page-template.js";

// Nested under this package (not /tmp) so Node/Vite module resolution
// walking up from the generated project finds packages/publish/node_modules
// — which is where @prefab/blocks, astro and @astrojs/react actually live
// under pnpm's workspace layout.
const WORKSPACE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".astro-workspace");

export interface SiteBuildData {
  site: SiteManifest;
  theme: ThemeDocument;
  pages: PageDocument[];
  posts: PostDocument[];
  /** Slice 6 — see build.ts's BuildSiteBundleInput for what these are. Optional here only so existing direct callers of createBuildWorkspace in tests keep compiling; build-worker.ts always supplies both. */
  runtimeApiUrl?: string;
  turnstileSiteKey?: string;
}

export interface BuildWorkspace {
  root: string;
  outDir: string;
  cleanup: () => Promise<void>;
}

export async function createBuildWorkspace(data: SiteBuildData): Promise<BuildWorkspace> {
  await mkdir(WORKSPACE_ROOT, { recursive: true });
  const root = await mkdtemp(path.join(WORKSPACE_ROOT, "build-"));
  const pagesDir = path.join(root, "src", "pages");
  await mkdir(pagesDir, { recursive: true });

  await writeFile(path.join(root, "src", "data.json"), JSON.stringify(data), "utf8");
  await writeFile(path.join(pagesDir, "[...slug].astro"), SITE_PAGE_ASTRO, "utf8");

  const outDir = path.join(root, "dist");

  return {
    root,
    outDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export async function ensureBundleStore(bundleStoreDir: string): Promise<void> {
  await mkdir(bundleStoreDir, { recursive: true });
}
