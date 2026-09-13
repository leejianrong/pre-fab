import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyReply } from "fastify";

/**
 * Same content-type map as apps/api/src/app.ts's
 * BUNDLE_CONTENT_TYPE_BY_EXTENSION (deliberately duplicated, not shared —
 * apps/api is the control plane) — a real map, not one
 * `application/octet-stream` exception, since a bundle can ship a hydrated
 * island's JS chunk (Slice 6's Form block) and a browser's strict
 * MIME-type checking for `<script type="module">` refuses to execute a
 * script served as `application/octet-stream`.
 */
const BUNDLE_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

/**
 * Serves one file out of the exported bundle directory this instance was
 * started against — a self-hosted instance serves exactly one site, so
 * there is no content-addressed multi-bundle store or host-based routing
 * to do, unlike apps/api's equivalent (serveBundleFile).
 */
export async function serveBundleFile(
  bundleDir: string,
  wildcardPath: string,
  reply: FastifyReply,
  /** The request's own path — used only to build the directory redirect below (KAN-1262). */
  requestUrl?: string,
): Promise<FastifyReply> {
  const relativePath = wildcardPath === "" || wildcardPath.endsWith("/") ? `${wildcardPath}index.html` : wildcardPath;
  const filePath = path.join(bundleDir, relativePath);
  if (!filePath.startsWith(bundleDir)) {
    return reply.status(404).send({ error: { code: "not_found", message: "not found" } });
  }
  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    return reply.status(404).send({ error: { code: "not_found", message: "not found" } });
  }
  // KAN-1262, mirroring apps/api's serveBundleFile exactly (see that
  // function's own comment): a bare directory-style path is a directory on
  // disk, `stat` succeeds on it, and streaming it as a file is an opaque
  // 500. A self-hosted bundle is the same directory-format Astro output
  // the hosted one serves, so it needs the same redirect to stay faithful.
  if (stats.isDirectory()) {
    if (requestUrl === undefined) {
      return reply.status(404).send({ error: { code: "not_found", message: "not found" } });
    }
    const index = requestUrl.indexOf("?");
    const pathname = index === -1 ? requestUrl : requestUrl.slice(0, index);
    const query = index === -1 ? "" : requestUrl.slice(index);
    return reply.redirect(`${pathname}/${query}`, 302);
  }
  reply.type(BUNDLE_CONTENT_TYPE_BY_EXTENSION[path.extname(filePath)] ?? "application/octet-stream");
  return reply.send(createReadStream(filePath));
}
