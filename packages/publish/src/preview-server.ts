import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/**
 * Serves an already-built bundle directory over plain HTTP, no network
 * beyond localhost — this is what makes `prefab preview` work with the
 * network blocked (R16). Deliberately not Astro's own `astro preview`, to
 * avoid a second Vite/Astro process for something this small.
 */
export function servePreview(distDir: string, port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const requestedPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
      const candidates = [
        path.join(distDir, requestedPath),
        path.join(distDir, requestedPath, "index.html"),
        path.join(distDir, requestedPath.endsWith("/") ? "" : `${requestedPath}.html`),
      ];

      for (const candidate of candidates) {
        if (!candidate.startsWith(distDir)) continue;
        try {
          const stats = await stat(candidate);
          if (!stats.isFile()) continue;
          const body = await readFile(candidate);
          res.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(candidate)] ?? "application/octet-stream" });
          res.end(body);
          return;
        } catch {
          continue;
        }
      }

      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    })();
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${resolvedPort}`,
        close: () => new Promise((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}
