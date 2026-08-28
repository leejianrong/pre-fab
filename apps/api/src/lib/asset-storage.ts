import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * Content-addressed local-disk storage, the same shape as
 * @prefab/publish's bundle store (ADR-0007's pattern, reused here rather
 * than reinvented): a real object store (R2, per PLAN.md's stack) is a
 * drop-in swap for this module's two functions without touching any
 * caller, since nothing outside this file knows the bytes live on disk.
 */

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};

export function extensionFor(contentType: string, filename: string): string {
  const known = EXTENSION_BY_CONTENT_TYPE[contentType.toLowerCase()];
  if (known) return known;
  const fromName = path.extname(filename);
  return fromName || ".bin";
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Writes bytes at a content-addressed path; a no-op if that exact address already exists (dedup is by hash, so the bytes are always identical when the path matches). */
export async function writeAssetFile(storeDir: string, key: string, bytes: Buffer): Promise<void> {
  const filePath = path.join(storeDir, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath);
    return; // already on disk with this exact content address
  } catch {
    await writeFile(filePath, bytes);
  }
}

export async function readAssetFile(storeDir: string, key: string): Promise<Buffer> {
  return readFile(path.join(storeDir, key));
}

export interface ImageVariant {
  width: number;
  key: string;
}

export interface ImageProcessResult {
  width: number;
  height: number;
  variants: ImageVariant[];
}

// Widths this build generates for any image asset wider than the width
// itself — narrower originals are left as-is rather than upscaled.
const VARIANT_WIDTHS = [480, 960, 1600];

/**
 * Generates the responsive width variants SLICES.md's integration test
 * expects ("Responsive image variants are generated and referenced
 * correctly"). Returns `{ width: 0, height: 0, variants: [] }` for a
 * non-image content type or bytes sharp can't parse — the caller still
 * stores the asset itself either way (R7-style: upload never blocks on a
 * best-effort derived feature), it just has no width/height/variants.
 */
export async function processImage(storeDir: string, sha256: string, contentType: string, bytes: Buffer): Promise<ImageProcessResult> {
  if (!contentType.startsWith("image/") || contentType === "image/svg+xml") {
    return { width: 0, height: 0, variants: [] };
  }

  try {
    const image = sharp(bytes);
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width === 0 || height === 0) return { width: 0, height: 0, variants: [] };

    const variants: ImageVariant[] = [];
    for (const targetWidth of VARIANT_WIDTHS) {
      if (targetWidth >= width) continue;
      const resized = await sharp(bytes).resize({ width: targetWidth }).webp().toBuffer();
      const key = `${sha256}-w${targetWidth}.webp`;
      await writeAssetFile(storeDir, key, resized);
      variants.push({ width: targetWidth, key });
    }
    return { width, height, variants };
  } catch {
    // Not a valid/decodable image (corrupt upload, unsupported subformat) — store the original bytes, generate no variants.
    return { width: 0, height: 0, variants: [] };
  }
}
