import type { Command } from "../registry.js";
import { writeCheckoutPage, writeCheckoutPost, writeCheckoutSite, writeCheckoutTheme } from "../checkout.js";

export interface PullArgs {
  siteId: string;
  dir: string;
}

export interface PullResult {
  site: { id: string; slug: string; name: string };
  pageCount: number;
  postCount: number;
}

/** Every post on the site, unpaginated — pull/export need the whole collection, not a page of it (post.list's own pagination is for the editor/an agent browsing, not the file-tree projection). */
async function allPosts(ctx: Parameters<Command<PullArgs, PullResult>["run"]>[0], siteId: string) {
  const all: Awaited<ReturnType<typeof ctx.api.listPosts>>["posts"] = [];
  let offset = 0;
  for (;;) {
    const page = await ctx.api.listPosts(siteId, { limit: 100, offset });
    all.push(...page.posts);
    offset += page.posts.length;
    if (page.posts.length === 0 || all.length >= page.total) break;
  }
  return all;
}

async function runPull(ctx: Parameters<Command<PullArgs, PullResult>["run"]>[0], args: PullArgs): Promise<PullResult> {
  const site = await ctx.api.getSite(args.siteId);
  const theme = await ctx.api.getTheme(args.siteId);
  const pageRefs = await ctx.api.listPages(args.siteId);
  const documents = await Promise.all(pageRefs.map((p) => ctx.api.getPage(args.siteId, p.id)));
  const posts = await allPosts(ctx, args.siteId);

  await writeCheckoutSite(args.dir, { id: site.id, slug: site.slug, name: site.name });
  await writeCheckoutTheme(args.dir, { schemaVersion: theme.schemaVersion, tokens: theme.tokens });
  for (const document of documents) await writeCheckoutPage(args.dir, document);
  for (const post of posts) await writeCheckoutPost(args.dir, post);

  return { site: { id: site.id, slug: site.slug, name: site.name }, pageCount: documents.length, postCount: posts.length };
}

export const pull: Command<PullArgs, PullResult> = {
  name: "pull",
  description: "Materialise a site as readable files on disk (ADR-0002's bidirectional projection)",
  run: runPull,
};

/** Same mechanism as `pull` — export dogfoods the projection format (ADR-0002), so the two never drift. */
export const exportSite: Command<PullArgs, PullResult> = {
  name: "export",
  description: "Export a site as a portable file tree — free, on every plan, always (R7)",
  run: runPull,
};
