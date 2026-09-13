import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp, isRuntimeApiPath } from "../src/app.js";

const { Pool } = pg;

// KAN-1255. The bug this file exists to prevent: @fastify/cors answers every
// preflight from one global onRequest hook, so a single EDITOR_ORIGIN-scoped
// registration silently answered /v1/runtime/* preflights too — 204 with no
// access-control-allow-origin, which a browser treats as a refusal. Every
// visitor-facing write (forms, bookings, event sign-ups, payments, cart
// checkout) was therefore broken from any real published-site domain, which
// is *always* a different origin than EDITOR_ORIGIN in production.
//
// This is deliberately a unit test, not an integration one: a CORS preflight
// is answered before routing reaches a handler, so it needs no Postgres, and
// belongs in the suite `pnpm run ci` gates every push on. The e2e suite could
// not have caught this — its harness drives the live site same-origin.

const EDITOR_ORIGIN = "https://editor.prefab.test";
const PUBLISHED_SITE_ORIGIN = "https://acme-bakery.example";

let app: FastifyInstance;
let pool: pg.Pool;
let previousEditorOrigin: string | undefined;

beforeAll(async () => {
  previousEditorOrigin = process.env.EDITOR_ORIGIN;
  process.env.EDITOR_ORIGIN = EDITOR_ORIGIN;
  // Never connected to — a preflight is answered in an onRequest hook, long
  // before any route handler asks for a client.
  pool = new Pool({ connectionString: "postgres://unused:unused@127.0.0.1:1/unused" });
  app = buildApp({ pool, bundleStoreDir: "/tmp/prefab-cors-test-bundles", assetStoreDir: "/tmp/prefab-cors-test-assets" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  if (previousEditorOrigin === undefined) delete process.env.EDITOR_ORIGIN;
  else process.env.EDITOR_ORIGIN = previousEditorOrigin;
});

/** Exactly what a browser sends before a cross-origin write, and nothing more. */
function preflight(url: string, method: string, origin: string) {
  return app.inject({
    method: "OPTIONS",
    url,
    headers: { origin, "access-control-request-method": method, "access-control-request-headers": "content-type" },
  });
}

// One per visitor-facing route family — these are the surfaces a published
// site's own islands call, and each one shipped broken for three milestones.
const RUNTIME_PREFLIGHTS: Array<[name: string, url: string, method: string]> = [
  ["form submission", "/v1/runtime/forms/01JBFORM00000000000000000/submissions", "POST"],
  ["booking create", "/v1/runtime/booking-widgets/01JBWIDGET000000000000000/bookings", "POST"],
  ["slot listing", "/v1/runtime/booking-widgets/01JBWIDGET000000000000000/slots", "GET"],
  ["booking cancel", "/v1/runtime/bookings/01JBSITE00000000000000000/01JBBOOKING00000000000000/cancel", "POST"],
  ["booking reschedule", "/v1/runtime/bookings/01JBSITE00000000000000000/01JBBOOKING00000000000000/reschedule", "POST"],
  // No hand-written OPTIONS route ever existed for these two — more evidence
  // that per-route preflight handlers are the wrong mechanism here.
  ["booking read", "/v1/runtime/bookings/01JBSITE00000000000000000/01JBBOOKING00000000000000", "GET"],
  ["booking manage", "/v1/runtime/bookings/01JBSITE00000000000000000/01JBBOOKING00000000000000/manage", "GET"],
  ["event sign-up", "/v1/runtime/event-signups/01JBEVENT0000000000000000/signups", "POST"],
  ["payment checkout", "/v1/runtime/payment-blocks/01JBBLOCK0000000000000000/checkout", "POST"],
  ["subscription checkout", "/v1/runtime/subscription-blocks/01JBBLOCK0000000000000000/checkout", "POST"],
  ["cart checkout", "/v1/runtime/sites/01JBSITE00000000000000000/cart-checkout", "POST"],
  ["cart receipt", "/v1/runtime/sites/01JBSITE00000000000000000/cart-checkout/01JBCART00000000000000000/receipt", "GET"],
  ["product stock", "/v1/runtime/sites/01JBSITE00000000000000000/products/01JBPROD00000000000000000/stock", "GET"],
];

describe("CORS preflight on the visitor-facing runtime API", () => {
  it.each(RUNTIME_PREFLIGHTS)("allows a %s preflight from a published site's own origin", async (_name, url, method) => {
    const response = await preflight(url, method, PUBLISHED_SITE_ORIGIN);

    expect(response.statusCode).toBeLessThan(300);
    // The one assertion the bug failed: a browser aborts the real request
    // unless this header is present and matches (or is the wildcard).
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(String(response.headers["access-control-allow-methods"] ?? "")).toContain(method);
    // Wildcard origin and credentials are mutually exclusive per the CORS
    // spec — and these routes carry no cookie by design (ADR-0007/ADR-0010).
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("allows the actual cross-origin write through, not just its preflight", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/runtime/forms/01JBFORM00000000000000000/submissions",
      headers: { origin: PUBLISHED_SITE_ORIGIN, "content-type": "application/json" },
      payload: { values: {} },
    });

    // Whatever this unconfigured form does (404s, here), the response must
    // still be readable cross-origin or the island cannot show the outcome.
    expect(response.headers["access-control-allow-origin"]).toBe("*");
  });

  it("does not need the caller's origin to be known in advance", async () => {
    const a = await preflight("/v1/runtime/forms/01JBFORM00000000000000000/submissions", "POST", "https://a-customers-own-domain.test");
    const b = await preflight("/v1/runtime/forms/01JBFORM00000000000000000/submissions", "POST", "http://localhost:4321");

    expect(a.headers["access-control-allow-origin"]).toBe("*");
    expect(b.headers["access-control-allow-origin"]).toBe("*");
  });
});

describe("CORS preflight on the control plane", () => {
  it("still allows the editor SPA's own credentialed origin", async () => {
    const response = await preflight("/v1/sites", "POST", EDITOR_ORIGIN);

    expect(response.statusCode).toBeLessThan(300);
    expect(response.headers["access-control-allow-origin"]).toBe(EDITOR_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("refuses an untrusted origin — the runtime's wildcard must not leak here", async () => {
    const response = await preflight("/v1/sites", "POST", PUBLISHED_SITE_ORIGIN);

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("never hands a session-bearing route the wildcard origin", async () => {
    for (const url of ["/v1/sites", "/v1/me", "/v1/dev/login", "/v1/tokens"]) {
      const response = await preflight(url, "POST", PUBLISHED_SITE_ORIGIN);
      expect(response.headers["access-control-allow-origin"]).not.toBe("*");
    }
  });
});

describe("isRuntimeApiPath", () => {
  it("matches the visitor-facing prefix, with or without a query string", () => {
    expect(isRuntimeApiPath("/v1/runtime/forms/abc/submissions")).toBe(true);
    expect(isRuntimeApiPath("/v1/runtime/bookings/s/b?token=xyz")).toBe(true);
  });

  it("does not match the control plane, or anything merely prefixed like it", () => {
    expect(isRuntimeApiPath("/v1/sites")).toBe(false);
    expect(isRuntimeApiPath("/v1/runtime")).toBe(false);
    expect(isRuntimeApiPath("/v1/runtimex/forms")).toBe(false);
    expect(isRuntimeApiPath("/health")).toBe(false);
  });

  it("refuses dot segments, so no control-plane path can dress up as a runtime one", () => {
    expect(isRuntimeApiPath("/v1/runtime/../sites")).toBe(false);
    expect(isRuntimeApiPath("/v1/runtime/./forms/abc/submissions")).toBe(false);
  });
});
