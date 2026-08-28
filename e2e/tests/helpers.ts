import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import http from "node:http";
import path from "node:path";
import type { Page } from "@playwright/test";
import { ApiClient, type BlockNode, type CreateSiteResult } from "@prefab/api-client";
import { newUlid } from "@prefab/schema";
import { createContext, type CommandContext } from "@prefab/commands";
import { SEED_EMAIL } from "../global-setup.js";

export const API_URL = "http://localhost:8788";
export const EDITOR_URL = "http://localhost:5174";
export const E2E_BUNDLE_STORE_DIR = path.join(process.cwd(), ".data", "bundles");

/** A context authenticated the same way the CLI is — a real per-site API token, minted through a session (ADR-0001). */
export async function authenticatedContext(siteSlugPrefix: string): Promise<{
  ctx: CommandContext;
  site: CreateSiteResult;
  token: string;
}> {
  const bootstrap = new ApiClient({ baseUrl: API_URL });
  await bootstrap.devLogin(SEED_EMAIL);
  const site = await bootstrap.createSite({ slug: `${siteSlugPrefix}-${Date.now()}`, name: siteSlugPrefix });
  const issued = await bootstrap.createToken(site.site.id, { name: "e2e" });
  const ctx = createContext({ apiUrl: API_URL, token: issued.token });
  return { ctx, site, token: issued.token };
}

export async function newCheckoutDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "pf-e2e-checkout-"));
}

/** Logs the seeded dev account into the browser session the same way LoginScreen does. */
export async function loginInBrowser(page: Page): Promise<void> {
  await page.goto(EDITOR_URL);
  await page.getByLabel(/seeded account email/i).fill(SEED_EMAIL);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForSelector("text=Your sites", { timeout: 15_000 });
}

/**
 * Opens a site already visible in the (already logged-in) site picker.
 * Not an exact match — the picker's button text is `"{name} ({slug})"`
 * (SitePicker.tsx), so no element's full text is ever exactly the site
 * name alone; a unique-enough name (every caller uses a Date.now()-suffixed
 * or otherwise distinctive one) makes substring matching unambiguous.
 */
export async function openSiteByName(page: Page, siteName: string): Promise<void> {
  await page.getByText(siteName).first().click();
  await page.waitForSelector('button:has-text("Publish")', { timeout: 15_000 });
}

export function canvasFrame(page: Page) {
  return page.frameLocator("iframe").first();
}

/**
 * Navigates to a site's real public address (`<slug>.prefab.local`, R1's
 * free hosting — apps/api's host-based routing fallback) rather than the
 * internal `/v1/bundles/:hash/*` preview URL. The two are not
 * interchangeable for anything that fetches its own assets by an
 * absolute, root-relative path (a hydrated island's JS chunk, Slice 6's
 * Form block) — the bundle-hash URL nests content under a path prefix, so
 * a root-relative `/_astro/*.js` reference 404s there but resolves
 * correctly once the page is actually served from its domain's root, the
 * same way a real production hostname always is.
 *
 * No local DNS needed: this is not a real `.local` hostname at all — every
 * request Chromium would make for it is intercepted before any DNS lookup
 * and proxied here, in the test process, to the real API listener at
 * API_URL, carrying the browser's own `Host: <hostname>` header through
 * unchanged so apps/api's host-based fallback resolves it exactly as it
 * would a real subdomain. (Rewriting the `host` header on Playwright's
 * `route.continue()` does not work reliably — Chromium's network stack
 * re-derives it from the connection target — so the proxy fetches with
 * Node's own `http` client instead, which has no such restriction.)
 */
export async function gotoLiveSite(page: Page, hostname: string): Promise<void> {
  const apiOrigin = new URL(API_URL);
  await page.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const upstream = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const proxied = http.request(
        {
          protocol: apiOrigin.protocol,
          hostname: apiOrigin.hostname,
          port: apiOrigin.port,
          method: request.method(),
          path: requestUrl.pathname + requestUrl.search,
          headers: { ...request.headers(), host: hostname, "accept-encoding": "identity" },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) }));
        },
      );
      proxied.on("error", reject);
      const body = request.postDataBuffer();
      if (body) proxied.write(body);
      proxied.end();
    });

    const { "transfer-encoding": _te, "content-length": _cl, connection: _conn, ...headers } = upstream.headers;
    await route.fulfill({
      status: upstream.status,
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : (v ?? "")])),
      body: upstream.body,
    });
  });
  await page.goto(`http://${hostname}/`);
}

/** Default props for every first-party block type, keyed by block type — for building test documents that exercise the whole library at once. */
export const ALL_BLOCK_TYPE_PROPS: Record<string, Record<string, unknown>> = {
  hero: { heading: "Hero heading", subheading: "Hero subheading", ctaLabel: "Go", ctaHref: "#", background: "background" },
  heading: { text: "Section heading", level: "h2", size: "heading", align: "left" },
  richtext: { html: "Some rich text content.", size: "body", align: "left" },
  image: { src: "https://placehold.co/800x400", alt: "placeholder", caption: "", radius: "card" },
  gallery: {
    images: [
      { src: "https://placehold.co/400x300", alt: "one" },
      { src: "https://placehold.co/400x300", alt: "two" },
    ],
    columns: 2,
  },
  columns: { count: 2, gap: "element" },
  spacer: { height: "lg" },
  button: { label: "Click me", href: "#", variant: "primary", align: "left" },
  cardgrid: {
    cards: [{ title: "Card one", body: "Card body", href: "#" }],
    columns: 3,
  },
  testimonial: { quote: "This product changed my life.", author: "A. Customer", role: "CEO, Acme" },
  faq: { items: [{ question: "Does it work?", answer: "Yes." }] },
  contactdetails: { heading: "Contact us", email: "hello@example.com", phone: "555-0100", address: "1 Main St" },
  mapembed: { query: "1600 Amphitheatre Parkway, Mountain View, CA", height: "md" },
  footer: { text: "© Example Co", links: [{ label: "Privacy", href: "#" }] },
  nav: { brand: "Example Co", links: [{ label: "Home", href: "#" }] },
  embed: { html: "<p>embedded</p>", height: "md" },
  form: {
    heading: "Contact us",
    fields: [
      { type: "text", label: "Name", name: "name", required: true, options: "" },
      { type: "email", label: "Email", name: "email", required: true, options: "" },
      { type: "textarea", label: "Message", name: "message", required: true, options: "" },
    ],
    submitLabel: "Submit",
    successMessage: "Thanks — we'll be in touch.",
    turnstileEnabled: false,
  },
};

export const ALL_BLOCK_TYPES = Object.keys(ALL_BLOCK_TYPE_PROPS);

/** One block of every first-party type, flat and top-level, for a page that exercises the whole library. */
export function allBlockTypesBlocks(): BlockNode[] {
  return ALL_BLOCK_TYPES.map((type, index) => ({
    id: newUlid(),
    type,
    parent: null,
    order: (index + 1) * 1000,
    schemaVersion: 1,
    props: ALL_BLOCK_TYPE_PROPS[type]!,
    responsive: {},
  }));
}

/** `count` blocks, cycling through a fixed rotation of light, cheap-to-render block types — for volume/performance tests where content doesn't matter. */
export function manyMixedBlocks(count: number): BlockNode[] {
  const rotation = ["hero", "heading", "richtext", "spacer", "button"];
  return Array.from({ length: count }, (_, index) => {
    const type = rotation[index % rotation.length]!;
    return {
      id: newUlid(),
      type,
      parent: null,
      order: (index + 1) * 1000,
      schemaVersion: 1,
      props: { ...ALL_BLOCK_TYPE_PROPS[type]! },
      responsive: {},
    };
  });
}
