import path from "node:path";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { servePreview } from "@prefab/publish";
import type { Command } from "../registry.js";
import { buildCheckout } from "./build.js";

/**
 * `playwright`'s own browser resolution expects the exact revision it was
 * built against; a pre-installed Chromium at a different revision (common
 * in a managed sandbox — see the environment notes) needs an explicit
 * `executablePath` instead of triggering a download. Returns undefined
 * when nothing matches, letting Playwright fall back to its own default.
 */
async function findPrebuiltChromium(): Promise<string | undefined> {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersPath) return undefined;
  let entries: string[];
  try {
    entries = await readdir(browsersPath);
  } catch {
    return undefined;
  }
  const match = entries.find((e) => /^chromium-\d+$/.test(e));
  return match ? path.join(browsersPath, match, "chrome-linux", "chrome") : undefined;
}

export interface PreviewArgs {
  dir: string;
  bundleStoreDir: string;
  /** Skip screenshot capture — used by callers that just want the URL. */
  screenshot?: boolean;
}

export interface PreviewResult {
  previewUrl: string;
  contentHash: string;
  /** null when Chromium isn't available in this environment — never a hard failure (R16: offline still succeeds). */
  screenshotPath: string | null;
  close: () => Promise<void>;
}

async function captureScreenshot(url: string): Promise<string | null> {
  try {
    const { chromium } = await import("playwright");
    const outDir = await mkdtemp(path.join(tmpdir(), "pf-preview-shot-"));
    const outPath = path.join(outDir, "preview.png");
    const executablePath = await findPrebuiltChromium();
    const browser = await chromium.launch(executablePath ? { executablePath } : undefined);
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "load" });
      await page.screenshot({ path: outPath });
    } finally {
      await browser.close();
    }
    return outPath;
  } catch {
    return null;
  }
}

/**
 * Builds and serves a local checkout with no network beyond loopback
 * (R16). `site outline` and this are the two things ADR-0003 calls out by
 * name as first-class agent deliverables (R14, R15) rather than
 * afterthoughts — an agent that cannot see its own output produces ugly
 * sites.
 */
export const preview: Command<PreviewArgs, PreviewResult> = {
  name: "preview",
  description: "Build a local checkout and serve it, with a stable URL and a screenshot (R15/R16)",
  async run(_ctx, args) {
    const built = await buildCheckout(args);
    const server = await servePreview(built.bundlePath);
    const screenshotPath = args.screenshot === false ? null : await captureScreenshot(server.url);
    return { previewUrl: server.url, contentHash: built.contentHash, screenshotPath, close: server.close };
  },
};
