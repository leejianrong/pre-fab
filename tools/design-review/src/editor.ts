import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { ApiClient } from "@prefab/api-client";

/**
 * KAN-1202: screenshots the editor's own key screens — the template
 * picker (SitePicker.tsx, shown right after login) and an open site's
 * editor canvas — by driving Playwright against a *live* dev stack, the
 * same way e2e/tests/helpers.ts's `loginInBrowser`/`openSiteByName` do.
 * Unlike the templates side of this tool, there's no static bundle to
 * build here: the editor is a real React app, so this needs `make
 * dev`/`make up` (or the native dev servers) already running — see
 * tools/design-review's README note for what to start first.
 */

const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";

async function resolveChromiumPath(): Promise<string> {
  if (existsSync(PREINSTALLED_CHROMIUM)) return PREINSTALLED_CHROMIUM;
  return chromium.executablePath();
}

/** apps/api/src/seed.ts's own default — overridable via SEED_ACCOUNT_EMAIL, same env var that script reads. */
const DEFAULT_SEED_EMAIL = "owner@example.com";

/**
 * A stable, recognizable name so re-running this tool reuses the same demo
 * site (via `listSites`) rather than piling up a new one on every run.
 */
const DEMO_SITE_NAME = "Design Review Canvas";
const DEMO_SITE_SLUG_PREFIX = "design-review-canvas";
const DEMO_TEMPLATE_ID = "consultant";

export interface EditorScreenshotOptions {
  editorUrl: string;
  apiUrl: string;
  seedEmail?: string;
}

export interface EditorScreenshotResult {
  files: string[];
}

async function assertReachable(apiUrl: string, editorUrl: string): Promise<void> {
  const check = async (url: string, label: string) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`status ${response.status}`);
    } catch (error) {
      throw new Error(
        `${label} isn't answering at ${url} (${error instanceof Error ? error.message : String(error)}).\n` +
          "The editor screenshots need the real dev stack running first — start it with `make dev` or `make up`, then re-run this tool.",
      );
    }
  };
  await check(`${apiUrl}/health`, "the API");
  await check(editorUrl, "the editor");
}

/** Logs the seeded dev account into the browser session, exactly as e2e/tests/helpers.ts's `loginInBrowser` does. */
async function loginInBrowser(page: Page, editorUrl: string, seedEmail: string): Promise<void> {
  await page.goto(editorUrl);
  await page.getByLabel(/seeded account email/i).fill(seedEmail);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForSelector("text=Your sites", { timeout: 15_000 });
}

/** Creates (or reuses) one site with real template content, so the canvas screenshot shows an actual page instead of an empty one. */
async function ensureDemoSite(apiUrl: string, seedEmail: string): Promise<{ id: string; name: string }> {
  const api = new ApiClient({ baseUrl: apiUrl });
  await api.devLogin(seedEmail);
  const sites = await api.listSites();
  const existing = sites.find((s) => s.name === DEMO_SITE_NAME);
  if (existing) return existing;

  const created = await api.createSiteFromTemplate(DEMO_TEMPLATE_ID, {
    slug: `${DEMO_SITE_SLUG_PREFIX}-${Date.now()}`,
    name: DEMO_SITE_NAME,
  });
  return created.site;
}

export async function screenshotEditor(outDir: string, options: EditorScreenshotOptions): Promise<EditorScreenshotResult> {
  await mkdir(outDir, { recursive: true });
  const seedEmail = options.seedEmail ?? process.env.SEED_ACCOUNT_EMAIL ?? DEFAULT_SEED_EMAIL;

  await assertReachable(options.apiUrl, options.editorUrl);
  const demoSite = await ensureDemoSite(options.apiUrl, seedEmail);

  const executablePath = await resolveChromiumPath();
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  const files: string[] = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await loginInBrowser(page, options.editorUrl, seedEmail);

    // The template-picker screen: SitePicker.tsx's "Your sites" list plus
    // TemplateGallery's "Start from a template" cards, right after login.
    await page.getByRole("heading", { name: /start from a template/i }).waitFor({ timeout: 15_000 });
    const pickerPath = path.join(outDir, "template-picker.png");
    await page.screenshot({ path: pickerPath, fullPage: true });
    files.push(pickerPath);

    // An open site's editor canvas.
    await page.getByText(demoSite.name).first().click();
    await page.getByRole("button", { name: /^publish$/i }).waitFor({ timeout: 15_000 });
    // Let the canvas iframe's Astro/React island finish its first paint —
    // same signal fidelity.ts's `waitForFormHydration` relies on, but here
    // any content is enough; a short settle avoids catching mid-layout.
    await page.waitForTimeout(1_000);
    const canvasPath = path.join(outDir, "editor-canvas.png");
    await page.screenshot({ path: canvasPath, fullPage: true });
    files.push(canvasPath);

    await page.close();
  } finally {
    await browser.close();
  }

  return { files };
}
