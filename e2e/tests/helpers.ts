import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
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
