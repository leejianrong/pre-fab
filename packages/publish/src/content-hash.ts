import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Sorted relative paths so the hash is independent of directory-read order. */
async function listFilesRecursive(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full, base)));
    } else {
      files.push(path.relative(base, full));
    }
  }
  return files.sort();
}

/**
 * Content address for a built bundle (ADR-0007): a hash of every output
 * file's path and bytes. Identical input documents produce an identical
 * hash, which is what makes the bundle store dedupe-safe and the pointer
 * swap in packages/db's `setLivePublish` meaningful — "publish" never
 * mutates a bundle already on disk, only ever adds a new one and re-points.
 */
export async function hashDirectory(dir: string): Promise<string> {
  const files = await listFilesRecursive(dir);
  const hash = createHash("sha256");
  for (const relativePath of files) {
    hash.update(relativePath.replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(await readFile(path.join(dir, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}
