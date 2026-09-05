import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @astrojs/react v6 (packages/publish) depends on Vite 8 — the editor SPA
// stays on the same major so the monorepo never carries two copies
// (ADR-0007). Puck runs only here, never inside Astro (ADR-0004).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Reachable from outside the container in docker-compose.yml's `editor`
    // service (Vite's default host binding, localhost-only, is invisible to
    // a mapped port); harmless for native dev too.
    host: true,
    // "localhost" (the default direct-port path) is always implicitly
    // allowed; "pre-fab.localhost" is only reached when
    // docker-compose.override.yml.example's opt-in machine-wide Traefik
    // instance fronts this dev server there instead, so requests arrive
    // with that Host header — Vite blocks unrecognized hosts by default
    // (DNS rebinding protection) and returns a bare "Blocked request" 403.
    allowedHosts: ["pre-fab.localhost"],
    // Proxied rather than called cross-origin: browsers do not reliably
    // treat different ports on `localhost` as the same site for cookie
    // storage (no registrable domain to compare), so a session cookie set
    // via a genuinely cross-origin fetch can silently fail to persist even
    // with correct CORS + credentials headers. Proxying keeps the browser
    // on one origin, which is also realistic — a real deployment fronts
    // both behind one domain too.
    proxy: {
      "/v1": { target: process.env.PREFAB_API_PROXY_TARGET ?? "http://localhost:8787", changeOrigin: true },
    },
  },
});
