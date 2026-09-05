import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { screenshotTemplates } from "./templates.js";
import { screenshotEditor } from "./editor.js";

/**
 * KAN-1202 / KAN-1208's shared deliverable: a repeatable way for an agent
 * (or a human) to "see" what a template or the editor UI actually looks
 * like, without opening a browser by hand.
 *
 * Deliberately a standalone script, not wired into CI (see this package's
 * README note in the repo root README.md) — it renders and screenshots,
 * asserting nothing, so there's nothing here for CI to gate on.
 *
 * Usage: `pnpm run design:screenshots` from the repo root, or
 * `pnpm --filter @prefab/design-review run screenshots` directly.
 */

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

const OUTPUT_DIR = path.join(REPO_ROOT, "tools", "design-review", "output");

// Matches scripts/dev-ports.sh's own defaults/env var names — the same
// ports `make dev`/`make up` land on unless something else was already
// listening there.
const editorPort = process.env.PREFAB_EDITOR_HOST_PORT ?? "5173";
const apiPort = process.env.PREFAB_API_HOST_PORT ?? "8787";
const editorUrl = process.env.PREFAB_DESIGN_REVIEW_EDITOR_URL ?? `http://localhost:${editorPort}`;
const apiUrl = process.env.PREFAB_DESIGN_REVIEW_API_URL ?? `http://localhost:${apiPort}`;

async function main(): Promise<void> {
  console.log(`Output directory: ${OUTPUT_DIR}\n`);

  console.log("Rendering and screenshotting all 9 templates (375px/768px/1440px)...");
  const bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-design-review-"));
  try {
    const templateResults = await screenshotTemplates(path.join(OUTPUT_DIR, "templates"), bundleStoreDir);
    for (const result of templateResults) {
      console.log(`  ✓ ${result.templateId}: ${result.files.length} screenshot(s)`);
    }
  } finally {
    await rm(bundleStoreDir, { recursive: true, force: true });
  }

  console.log(`\nScreenshotting the editor's template picker and an open site's canvas (${editorUrl})...`);
  try {
    const editorResult = await screenshotEditor(path.join(OUTPUT_DIR, "editor"), { editorUrl, apiUrl });
    for (const file of editorResult.files) {
      console.log(`  ✓ ${path.basename(file)}`);
    }
  } catch (error) {
    console.error(`\n✗ editor screenshots failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error("  (the template screenshots above still ran fine — this only affects the editor's own screens)");
    process.exitCode = 1;
    return;
  }

  console.log(`\nDone. All PNGs are under ${OUTPUT_DIR}`);
}

await main();
