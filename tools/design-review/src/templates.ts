import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { buildSiteBundle, servePreview } from "@prefab/publish";
import { TEMPLATE_MANIFESTS, loadTemplateCheckout } from "@prefab/templates/server";
import { newUlid, type SiteManifest, type ThemeDocument } from "@prefab/schema";

/**
 * KAN-1202: renders each of the 9 shipped templates through the exact same
 * `buildSiteBundle` path tools/checks' budgets.ts and fidelity.ts already
 * drive (apps/api's real publish pipeline, no DB/API in the loop — just the
 * template checkout straight off disk), then screenshots the built home
 * page at a few representative widths. Output is plain PNGs an agent can
 * Read directly — this is a design-review tool, not a correctness check,
 * so unlike budgets.ts/fidelity.ts it asserts nothing and is not wired
 * into CI (see tools/design-review's own README note).
 */

// Mirrors tools/checks' own comment (budgets.ts/fidelity.ts): this sandbox
// pre-installs Chromium at a revision Playwright's resolver doesn't
// expect. A normal machine (including CI, which runs `playwright install`)
// has no such path and falls through to Playwright's own resolution.
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";

async function resolveChromiumPath(): Promise<string> {
  if (existsSync(PREINSTALLED_CHROMIUM)) return PREINSTALLED_CHROMIUM;
  return chromium.executablePath();
}

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

/** 375/768/1440: the mobile/tablet/desktop breakpoints the card itself names. */
export const TEMPLATE_VIEWPORTS: Viewport[] = [
  { name: "mobile-375", width: 375, height: 900 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

export interface TemplateScreenshotResult {
  templateId: string;
  files: string[];
}

/**
 * Builds and screenshots every template's home page. `bundleStoreDir`
 * should be a scratch directory the caller removes afterwards (mirrors
 * budgets.ts/fidelity.ts's own throwaway `mkdtemp` use) — this tool has no
 * reason to leave built bundles behind, only the screenshots.
 */
export async function screenshotTemplates(outDir: string, bundleStoreDir: string): Promise<TemplateScreenshotResult[]> {
  await mkdir(outDir, { recursive: true });
  const executablePath = await resolveChromiumPath();
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });

  try {
    const results: TemplateScreenshotResult[] = [];

    for (const manifest of TEMPLATE_MANIFESTS) {
      const checkout = await loadTemplateCheckout(manifest.id);
      const siteId = newUlid();
      const siteManifest: SiteManifest = {
        id: siteId,
        slug: manifest.id,
        name: manifest.name,
        ownerId: newUlid(),
        schemaVersion: 1,
        pages: checkout.pages.map((p) => ({ id: p.id, slug: p.slug })),
      };
      const theme: ThemeDocument = { id: newUlid(), siteId, schemaVersion: 1, tokens: checkout.theme };

      const built = await buildSiteBundle({ site: siteManifest, theme, pages: checkout.pages, bundleStoreDir });
      const preview = await servePreview(built.bundlePath);

      const files: string[] = [];
      try {
        const page = await browser.newPage();
        // Same reasoning as fidelity.ts: the mapembed block's live Google
        // Maps iframe is not visually deterministic between runs — block
        // it so a re-run's screenshot isn't flagged as "changed" by tile
        // cache state that has nothing to do with pre-fab's own render.
        await page.route("https://www.google.com/maps**", (route) => route.abort());

        for (const viewport of TEMPLATE_VIEWPORTS) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.goto(preview.url, { waitUntil: "load" });
          const filePath = path.join(outDir, `${manifest.id}--${viewport.name}.png`);
          await page.screenshot({ path: filePath, fullPage: true });
          files.push(filePath);
        }
        await page.close();
      } finally {
        await preview.close();
      }

      results.push({ templateId: manifest.id, files });
    }

    return results;
  } finally {
    await browser.close();
    await rm(bundleStoreDir, { recursive: true, force: true });
  }
}
