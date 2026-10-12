import { describe, expect, it } from "vitest";
import type { PageDocument, PostDocument, ProductDocument } from "@prefab/schema";
import { generateSitemap } from "../src/feeds.js";

const page = (slug: string, types: string[] = []) =>
  ({ slug, title: slug, blocks: types.map((type, i) => ({ id: `b${slug}${i}`, type })) }) as unknown as PageDocument;
const post = (slug: string) => ({ id: slug, slug, title: slug }) as unknown as PostDocument;
const product = (slug: string) => ({ id: slug, slug, title: slug }) as unknown as ProductDocument;

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
const BASE = "https://demo.prefab.app";

describe("generateSitemap excludes detail template pages (KAN-1323)", () => {
  it("blog + shop: lists per-item routes, not the /article/ or /item/ templates", () => {
    const xml = generateSitemap({
      baseUrl: BASE,
      pages: [
        page("home"),
        page("blog", ["postlist"]),
        page("article", ["postdetail"]),
        page("shop", ["productgrid"]),
        page("item", ["productdetail"]),
      ],
      posts: [post("hello")],
      products: [product("mug")],
    });
    expect(locs(xml)).toEqual([
      `${BASE}/`,
      `${BASE}/blog/`,
      `${BASE}/shop/`,
      `${BASE}/article/hello/`,
      `${BASE}/item/mug/`,
    ]);
  });

  it("keeps a site with no detail pages unchanged", () => {
    const xml = generateSitemap({ baseUrl: BASE, pages: [page("home"), page("about")], posts: [] });
    expect(locs(xml)).toEqual([`${BASE}/`, `${BASE}/about/`]);
  });
});
