import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PageDocument, PostDocument, SiteManifest, ThemeDocument } from "@prefab/schema";

const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_WORKER_PATH = path.join(PACKAGE_ROOT, "src", "build-worker.ts");

export interface BuildSiteBundleInput {
  site: SiteManifest;
  theme: ThemeDocument;
  pages: PageDocument[];
  /** Defaults to `[]` — every existing caller (local `build`/`preview` from a checkout, the template-budgets check) builds fine with no posts at all. */
  posts?: PostDocument[];
  /** Anchors RSS/sitemap's absolute links. Defaults to a placeholder for callers with no real public address yet (an offline local build, R16). */
  baseUrl?: string;
  /** Where the Form block's submit island posts to (Slice 6, ADR-0007). Defaults to empty — the island simply declines to submit rather than failing, so an offline local build (R16) still builds and previews fine with no runtime configured. */
  runtimeApiUrl?: string;
  /** Cloudflare Turnstile's public site key, not a secret — omitted forms render with no widget even if a form has Turnstile enabled. */
  turnstileSiteKey?: string;
  /** Slice 9 (ADR-0010, R10): the site's current availability rule, written into the bundle as `prefab-availability.json` so the self-host runtime can seed local slot computation with no control plane to snapshot it from at all — see build-worker.ts's own comment. Not page-document content (0008_slice9.sql), so unlike pages/posts this is handed in directly rather than derived from anything else in this input. Omitted or null when the site has never called `availability.set`. */
  availabilityRule?: PublishableAvailabilityRule | null;
  bundleStoreDir: string;
}

/** The same shape as @prefab/runtime's AvailabilityRuleManifest — duplicated, not imported, for the identical reason form-manifest.ts's PublishSafeFormManifest is (see that file's own comment). `siteId` travels with it because, unlike forms/booking widgets, self-host has no other bundle-carried record of which site it's hosting to seed this single-row table against. */
export interface PublishableAvailabilityRule {
  siteId: string;
  timezone: string;
  weeklyWindows: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>;
  dateOverrides: Array<{ date: string; closed: boolean; windows: Array<{ startMinute: number; endMinute: number }> }>;
  slotDurationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxHorizonDays: number;
}

export interface BuildSiteBundleResult {
  bundlePath: string;
  contentHash: string;
}

/**
 * The publish pipeline (ADR-0007): builds the given document set to a
 * static Astro output and lands it in the content-addressed bundle store.
 * Runs in a dedicated subprocess (build-worker.ts) — see that file for why
 * that isolation matters, not just for tests but for any long-lived caller.
 * Never touches an existing bundle — a build failure at any point simply
 * never reaches the point where a new address is written, so whatever was
 * live before this call stays byte-identical (R4). Works with no network
 * beyond what's already on disk in node_modules (R16).
 */
export async function buildSiteBundle(input: BuildSiteBundleInput): Promise<BuildSiteBundleResult> {
  const inputFile = await mkdtemp(path.join(tmpdir(), "pf-build-input-"));
  const inputPath = path.join(inputFile, "input.json");
  const resolvedInput = {
    ...input,
    posts: input.posts ?? [],
    baseUrl: input.baseUrl ?? `https://${input.site.slug}.prefab.invalid`,
    runtimeApiUrl: input.runtimeApiUrl ?? "",
    turnstileSiteKey: input.turnstileSiteKey ?? "",
    availabilityRule: input.availabilityRule ?? null,
  };
  await writeFile(inputPath, JSON.stringify(resolvedInput), "utf8");

  try {
    const { stdout, stderr, exitCode } = await runWorker(inputPath);
    if (exitCode !== 0) {
      throw new Error(`publish build failed (exit ${exitCode}):\n${stderr || stdout}`);
    }
    const result = JSON.parse(stdout) as BuildSiteBundleResult;
    return result;
  } finally {
    await rm(inputFile, { recursive: true, force: true });
  }
}

function runWorker(inputPath: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", BUILD_WORKER_PATH, inputPath], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: PACKAGE_ROOT,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}
