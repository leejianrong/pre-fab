import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { generateTemplateThumbnails } from "./templates.js";

/**
 * KAN-1206: regenerates the one committed preview thumbnail per template
 * (packages/templates/templates/<id>/thumbnail.jpg), the image
 * apps/editor's TemplateGallery card and apps/api's
 * `GET /v1/templates/:id/thumbnail` route serve. Re-run this any time a
 * template's site.json/theme.json content changes — nothing regenerates
 * these automatically, and a stale thumbnail is a silent design bug (the
 * card no longer matches what forking the template actually produces).
 *
 * Unlike `cli.ts`'s screenshots (gitignored scratch output), this writes
 * files meant to be committed — review the resulting `git diff --stat`
 * before committing, same as any other checked-in binary asset.
 *
 * Usage: `pnpm run generate:thumbnails` from the repo root, or
 * `pnpm --filter @prefab/design-review run generate:thumbnails` directly.
 */

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

async function main(): Promise<void> {
  console.log("Rendering and screenshotting all 9 templates for their thumbnail cards...");
  const bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-thumbnails-"));
  try {
    const results = await generateTemplateThumbnails(bundleStoreDir);
    for (const result of results) {
      const { size } = await stat(result.file);
      console.log(`  ✓ ${result.templateId}: ${result.file} (${Math.round(size / 1024)} KB)`);
    }
  } finally {
    await rm(bundleStoreDir, { recursive: true, force: true });
  }
  console.log("\nDone. Review the diff (git status/git diff --stat) before committing.");
}

await main();
