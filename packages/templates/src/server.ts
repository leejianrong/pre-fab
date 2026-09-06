import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PageDocument, ThemeTokens } from "@prefab/schema";
import { TEMPLATE_MANIFESTS, TemplateManifestSchema, type TemplateManifest } from "./manifest.js";

/**
 * Server-only: reads a template's checkout-format site tree off disk. Kept
 * out of "./index.js" (the browser-safe manifest module) because
 * apps/editor's template gallery only ever needs the metadata — loading the
 * actual pages happens once, server-side, at fork time.
 */
const TEMPLATES_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");

interface CheckoutThemeFile {
  schemaVersion: number;
  tokens: ThemeTokens;
}

export interface TemplateCheckout {
  manifest: TemplateManifest;
  theme: ThemeTokens;
  pages: PageDocument[];
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

/**
 * Loads one template's theme + pages exactly as authored — no re-keying
 * here. Fork-on-use (site.createFromTemplate, apps/api/src/app.ts) is what
 * assigns fresh ULIDs via @prefab/schema's rekeyPageForFork, so that two
 * callers loading the same template never see each other's ids collide.
 */
export async function loadTemplateCheckout(templateId: string): Promise<TemplateCheckout> {
  const manifest = TEMPLATE_MANIFESTS.find((t) => t.id === templateId);
  if (!manifest) throw new Error(`unknown template "${templateId}"`);
  TemplateManifestSchema.parse(manifest);

  const dir = path.join(TEMPLATES_ROOT, templateId);
  const theme = await readJson<CheckoutThemeFile>(path.join(dir, "theme.json"));

  const pagesDir = path.join(dir, "pages");
  const entries = await readdir(pagesDir);
  const files = entries.filter((f) => f.endsWith(".json")).sort();
  const pages = await Promise.all(files.map((f) => readJson<PageDocument>(path.join(pagesDir, f))));

  return { manifest, theme: theme.tokens, pages };
}

/** Filename convention for the checked-in preview image every template directory carries — see scripts/generate-thumbnails.ts (tools/design-review). */
export const TEMPLATE_THUMBNAIL_FILENAME = "thumbnail.jpg";

/**
 * KAN-1206: resolves a template id to its checked-in thumbnail's absolute
 * path. Validated against `TEMPLATE_MANIFESTS` the same way
 * `loadTemplateCheckout` is — `templateId` never reaches `path.join` unless
 * it's one of the fixed, known-good ids in that array, so there's no
 * path-traversal surface for apps/api's route to worry about.
 */
export function templateThumbnailPath(templateId: string): string {
  const manifest = TEMPLATE_MANIFESTS.find((t) => t.id === templateId);
  if (!manifest) throw new Error(`unknown template "${templateId}"`);
  return path.join(TEMPLATES_ROOT, manifest.id, TEMPLATE_THUMBNAIL_FILENAME);
}

export { TEMPLATE_MANIFESTS, TemplateManifestSchema, type TemplateManifest };
