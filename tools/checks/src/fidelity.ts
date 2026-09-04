import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { chromium, type Page } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { buildSiteBundle, ejectSite, servePreview } from "@prefab/publish";
import { DEFAULT_THEME_TOKENS, newUlid, type BlockNode, type PageDocument, type PostDocument, type SiteManifest, type ThemeDocument } from "@prefab/schema";

const execFileAsync = promisify(execFile);

// Mirrors budgets.ts's own comment: this sandbox pre-installs Chromium at a
// revision Playwright's resolver doesn't expect.
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";

async function resolveChromiumPath(): Promise<string> {
  if (existsSync(PREINSTALLED_CHROMIUM)) return PREINSTALLED_CHROMIUM;
  return chromium.executablePath();
}

/**
 * Duplicated from e2e/tests/helpers.ts's own `ALL_BLOCK_TYPE_PROPS` rather
 * than shared — tools/checks is a CI-only package with no reason to depend
 * on @prefab/e2e (a Playwright test harness, not a library), and the two
 * fixtures serve different purposes (that one exercises the real editor;
 * this one only needs valid props to render). Kept in sync by hand; a
 * missing or renamed block type here is caught immediately by this
 * check's own "every first-party block" assertion in its CLI wrapper.
 */
const NON_COLLECTION_BLOCK_PROPS: Record<string, Record<string, unknown>> = {
  hero: { heading: "Hero heading", subheading: "Hero subheading", ctaLabel: "Go", ctaHref: "#", background: "background", backgroundImage: "" },
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
  cardgrid: { cards: [{ title: "Card one", body: "Card body", href: "#" }], columns: 3 },
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
    ],
    submitLabel: "Submit",
    successMessage: "Thanks — we'll be in touch.",
    turnstileEnabled: false,
  },
};

const POSTLIST_PROPS = { postsPerPage: 10 };

function blockNode(type: string, order: number, props: Record<string, unknown>): BlockNode {
  return { id: newUlid(), type, parent: null, order, schemaVersion: 1, props, responsive: {} };
}

export const MAX_DIFF_PERCENT = 0.1;

export interface BlockFidelityResult {
  blockType: string;
  diffPercent: number;
  passed: boolean;
}

interface PageGroup {
  /** The route this page's blocks render at, relative to a served bundle's root. */
  route: string;
  blocks: BlockNode[];
}

function buildFixture(): { site: SiteManifest; theme: ThemeDocument; pages: PageDocument[]; posts: PostDocument[]; groups: PageGroup[] } {
  const siteId = newUlid();
  const homeId = newUlid();
  const blogId = newUlid();
  const postPageId = newUlid();
  const postId = newUlid();

  const homeBlocks = Object.entries(NON_COLLECTION_BLOCK_PROPS).map(([type, props], i) => blockNode(type, (i + 1) * 1000, props));
  const blogBlocks = [blockNode("postlist", 1000, POSTLIST_PROPS)];
  const postBlocks = [blockNode("postdetail", 1000, {})];

  const post: PostDocument = {
    id: postId,
    siteId,
    slug: "fidelity-post",
    title: "A fidelity test post",
    schemaVersion: 1,
    version: 0,
    date: "2026-01-01",
    author: "Fidelity",
    tags: [],
    cover: null,
    body: "Body text for the fidelity harness's one post.",
    locale: "en",
    status: "published",
  };

  const pages: PageDocument[] = [
    { id: homeId, siteId, slug: "home", title: "Home", schemaVersion: 1, version: 0, layoutMode: "flow", blocks: homeBlocks },
    { id: blogId, siteId, slug: "blog", title: "Blog", schemaVersion: 1, version: 0, layoutMode: "flow", blocks: blogBlocks },
    { id: postPageId, siteId, slug: "post", title: "Post", schemaVersion: 1, version: 0, layoutMode: "flow", blocks: postBlocks },
  ];

  const site: SiteManifest = {
    id: siteId,
    slug: "fidelity",
    name: "Fidelity Harness",
    ownerId: newUlid(),
    schemaVersion: 1,
    pages: pages.map((p) => ({ id: p.id, slug: p.slug })),
  };
  const theme: ThemeDocument = { id: newUlid(), siteId, schemaVersion: 1, tokens: DEFAULT_THEME_TOKENS };

  const groups: PageGroup[] = [
    { route: "/", blocks: homeBlocks },
    { route: "/blog", blocks: blogBlocks },
    { route: `/post/${post.slug}`, blocks: postBlocks },
  ];

  return { site, theme, pages, posts: [post], groups };
}

/** Pure (no browser) so it's directly unit-testable — a byte-identical pair of PNGs must diff at exactly 0%. */
export function pixelDiffPercent(a: Buffer, b: Buffer): number {
  const pngA = PNG.sync.read(a);
  const pngB = PNG.sync.read(b);
  if (pngA.width !== pngB.width || pngA.height !== pngB.height) return 100;
  const { width, height } = pngA;
  if (width === 0 || height === 0) return 0;
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(pngA.data, pngB.data, diff.data, width, height, { threshold: 0.1 });
  return (mismatched / (width * height)) * 100;
}

/** Same signal e2e/tests/forms.spec.ts's own `waitForFormHydration` uses — Astro drops an island's `ssr` attribute the instant client:load hydration completes. A no-op when the page has no such island. */
async function waitForFormHydration(page: Page): Promise<void> {
  const island = page.locator('astro-island[client="load"][ssr]');
  if ((await island.count()) === 0) return;
  await page.waitForSelector('astro-island[client="load"]:not([ssr])', { timeout: 10_000 });
}

/**
 * R9's fidelity harness: for every first-party block, screenshot it as
 * rendered by the normal hosted pipeline (`buildSiteBundle`) and as
 * rendered by an ejected-and-`npm run build`-from-scratch Astro project
 * (tier c, ADR-0010) built from the exact same document, and assert the
 * two are within 0.1% pixel delta. The hosted pipeline is also what tier
 * (a)'s export bundle is, so this is simultaneously R9's literal claim
 * ("an exported static bundle renders pixel-identical to the hosted
 * site") for every case where ejection introduces the most divergence
 * risk (vendored runtime shim, aliasing, a from-scratch dependency
 * install) — if fidelity holds here, it holds for the plainer tier (a)
 * copy too.
 */
export async function checkFidelity(workDir: string): Promise<BlockFidelityResult[]> {
  const { site, theme, pages, posts, groups } = buildFixture();

  const bundleStoreDir = path.join(workDir, "bundles");
  const hostedBuilt = await buildSiteBundle({ site, theme, pages, posts, bundleStoreDir });
  const hostedPreview = await servePreview(hostedBuilt.bundlePath);

  const ejectOutDir = path.join(workDir, "eject");
  await ejectSite({ site, theme, pages, posts, outDir: ejectOutDir });
  await execFileAsync("npm", ["install"], { cwd: ejectOutDir });
  await execFileAsync("npm", ["run", "build"], { cwd: ejectOutDir });
  const ejectedPreview = await servePreview(path.join(ejectOutDir, "dist"));

  const executablePath = await resolveChromiumPath();
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });

  try {
    const results: BlockFidelityResult[] = [];
    const hostedPage = await browser.newPage({ viewport: { width: 1280, height: 5000 } });
    const ejectedPage = await browser.newPage({ viewport: { width: 1280, height: 5000 } });

    // The mapembed block renders a live third-party iframe
    // (google.com/maps) — its actual pixels are Google's live map tiles,
    // which are not visually deterministic between two independent page
    // loads (traffic overlays, tile-cache state, timing), let alone across
    // machines. That non-determinism belongs to Google's servers, not to
    // pre-fab's own rendering — this check exists to catch a divergence in
    // what *pre-fab* emits (the iframe's src, size and position), so both
    // pages block the request identically instead, making the comparison
    // deterministic without weakening what it actually tests.
    for (const page of [hostedPage, ejectedPage]) {
      await page.route("https://www.google.com/maps**", (route) => route.abort());
    }

    for (const group of groups) {
      await hostedPage.goto(`${hostedPreview.url}${group.route}`, { waitUntil: "load" });
      await ejectedPage.goto(`${ejectedPreview.url}${group.route}`, { waitUntil: "load" });
      await waitForFormHydration(hostedPage);
      await waitForFormHydration(ejectedPage);

      for (const block of group.blocks) {
        const box = await hostedPage.locator(`[data-pf-block-id="${block.id}"]`).boundingBox();
        if (!box || box.width === 0 || box.height === 0) {
          results.push({ blockType: block.type, diffPercent: 100, passed: false });
          continue;
        }
        const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
        const [hostedShot, ejectedShot] = await Promise.all([
          hostedPage.screenshot({ clip }),
          ejectedPage.screenshot({ clip }),
        ]);
        const diffPercent = pixelDiffPercent(hostedShot, ejectedShot);
        results.push({ blockType: block.type, diffPercent, passed: diffPercent <= MAX_DIFF_PERCENT });
      }
    }

    return results;
  } finally {
    await browser.close();
    await hostedPreview.close();
    await ejectedPreview.close();
    await rm(bundleStoreDir, { recursive: true, force: true });
  }
}
