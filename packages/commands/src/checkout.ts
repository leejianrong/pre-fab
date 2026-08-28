import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageDocument, PostDocument, ThemeTokens } from "@prefab/schema";
import { parsePostFile, serializePostFile } from "@prefab/schema";

/**
 * The file-tree projection (ADR-0002): a site materialised as readable
 * files on disk. `pull` writes this shape; `push`/`import` read it back and
 * send it through exactly the same validation as any other write. Kept
 * pretty-printed (2-space JSON) — a human is meant to be able to open and
 * diff these with an ordinary editor or `git diff`.
 */
export interface CheckoutSiteFile {
  id: string;
  slug: string;
  name: string;
}

export interface CheckoutThemeFile {
  schemaVersion: number;
  tokens: ThemeTokens;
}

const SITE_FILE = "site.json";
const THEME_FILE = "theme.json";
const PAGES_DIR = "pages";
const POSTS_DIR = "posts";

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function writeCheckoutSite(dir: string, site: CheckoutSiteFile): Promise<void> {
  await writeJson(path.join(dir, SITE_FILE), site);
}

export async function readCheckoutSite(dir: string): Promise<CheckoutSiteFile> {
  return readJson<CheckoutSiteFile>(path.join(dir, SITE_FILE));
}

export async function writeCheckoutTheme(dir: string, theme: CheckoutThemeFile): Promise<void> {
  await writeJson(path.join(dir, THEME_FILE), theme);
}

export async function readCheckoutTheme(dir: string): Promise<CheckoutThemeFile> {
  return readJson<CheckoutThemeFile>(path.join(dir, THEME_FILE));
}

export async function writeCheckoutPage(dir: string, page: PageDocument): Promise<void> {
  await writeJson(path.join(dir, PAGES_DIR, `${page.slug}.json`), page);
}

export async function readCheckoutPages(dir: string): Promise<PageDocument[]> {
  const pagesDir = path.join(dir, PAGES_DIR);
  let entries: string[];
  try {
    entries = await readdir(pagesDir);
  } catch {
    return [];
  }
  const files = entries.filter((f) => f.endsWith(".json")).sort();
  return Promise.all(files.map((f) => readJson<PageDocument>(path.join(pagesDir, f))));
}

/** Slice 5: a post's file uses frontmatter + Markdown (@prefab/schema's serializePostFile), not raw JSON — "a file representation that is pleasant to edit by hand" (SLICES.md), the same way `pages/*.json` is pull's format for pages. */
export async function writeCheckoutPost(dir: string, post: PostDocument): Promise<void> {
  const filePath = path.join(dir, POSTS_DIR, `${post.slug}.md`);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, serializePostFile(post), "utf8");
}

export async function readCheckoutPosts(dir: string): Promise<PostDocument[]> {
  const postsDir = path.join(dir, POSTS_DIR);
  let entries: string[];
  try {
    entries = await readdir(postsDir);
  } catch {
    return [];
  }
  const files = entries.filter((f) => f.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (f) => parsePostFile(await readFile(path.join(postsDir, f), "utf8"))),
  );
}
