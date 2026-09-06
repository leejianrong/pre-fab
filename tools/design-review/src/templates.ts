import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { buildSiteBundle, servePreview } from "@prefab/publish";
import { TEMPLATE_MANIFESTS, loadTemplateCheckout, templateThumbnailPath, type TemplateManifest } from "@prefab/templates/server";
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

/**
 * Builds one template's home page through the real publish pipeline, serves
 * it, and opens a browser page routed at it (Google Maps' live iframe
 * blocked — see inline comment) — shared by `screenshotTemplates` (which
 * re-navigates once per viewport, so viewport-dependent rendering like
 * responsive `srcset` selection is captured correctly at each size) and
 * `generateTemplateThumbnails` (one viewport, one navigation). `fn` gets
 * the bare page with nothing navigated yet; it owns setting the
 * viewport(s) and navigating. Cleans up the preview server and browser
 * page whether `fn` throws or not; the caller still owns the browser
 * instance and `bundleStoreDir`.
 */
async function withTemplatePreviewPage<T>(
  browser: Browser,
  manifest: TemplateManifest,
  bundleStoreDir: string,
  fn: (page: Page, previewUrl: string) => Promise<T>,
): Promise<T> {
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

  try {
    const page = await browser.newPage();
    try {
      // Same reasoning as fidelity.ts: the mapembed block's live Google
      // Maps iframe is not visually deterministic between runs — block it
      // so a re-run's screenshot isn't flagged as "changed" by tile cache
      // state that has nothing to do with pre-fab's own render.
      await page.route("https://www.google.com/maps**", (route) => route.abort());
      return await fn(page, preview.url);
    } finally {
      await page.close();
    }
  } finally {
    await preview.close();
  }
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
      const files = await withTemplatePreviewPage(browser, manifest, bundleStoreDir, async (page, previewUrl) => {
        const shots: string[] = [];
        for (const viewport of TEMPLATE_VIEWPORTS) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.goto(previewUrl, { waitUntil: "load" });
          const filePath = path.join(outDir, `${manifest.id}--${viewport.name}.png`);
          await page.screenshot({ path: filePath, fullPage: true });
          shots.push(filePath);
        }
        return shots;
      });

      results.push({ templateId: manifest.id, files });
    }

    return results;
  } finally {
    await browser.close();
    await rm(bundleStoreDir, { recursive: true, force: true });
  }
}

/** Above-the-fold viewport a card thumbnail is cropped to — wide enough to read as "a real site," short enough that a long one-pager's thumbnail is still just the hero, not a full-page strip. */
export const THUMBNAIL_VIEWPORT: Viewport = { name: "thumbnail", width: 1280, height: 800 };

export interface TemplateThumbnailResult {
  templateId: string;
  file: string;
}

/**
 * KAN-1206: one representative screenshot per template, written straight
 * into that template's own directory (packages/templates/templates/<id>/)
 * rather than a scratch `outDir` — these are meant to be committed, unlike
 * `screenshotTemplates`' gitignored design-review output. Above-the-fold
 * only (`fullPage: false`) at `THUMBNAIL_VIEWPORT`, JPEG (`quality: 82`)
 * rather than PNG: a lossless full-bleed photo-heavy hero shot compresses
 * far worse than a lossy one, and nothing here needs pixel-exact output
 * the way fidelity.ts's eject comparison does.
 */
export async function generateTemplateThumbnails(bundleStoreDir: string): Promise<TemplateThumbnailResult[]> {
  const executablePath = await resolveChromiumPath();
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });

  try {
    const results: TemplateThumbnailResult[] = [];

    for (const manifest of TEMPLATE_MANIFESTS) {
      const filePath = await withTemplatePreviewPage(browser, manifest, bundleStoreDir, async (page, previewUrl) => {
        await page.setViewportSize({ width: THUMBNAIL_VIEWPORT.width, height: THUMBNAIL_VIEWPORT.height });
        await page.goto(previewUrl, { waitUntil: "load" });
        const dest = templateThumbnailPath(manifest.id);
        await page.screenshot({ path: dest, fullPage: false, type: "jpeg", quality: 82 });
        return dest;
      });

      results.push({ templateId: manifest.id, file: filePath });
    }

    return results;
  } finally {
    await browser.close();
    await rm(bundleStoreDir, { recursive: true, force: true });
  }
}
