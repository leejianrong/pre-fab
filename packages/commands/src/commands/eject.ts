import { ejectSite } from "@prefab/publish";
import type { Command } from "../registry.js";

/** Same shape as export-bundle.ts's own — see that command's comment for why it's duplicated rather than shared. */
async function allPosts(ctx: Parameters<Command<EjectArgs, EjectResult>["run"]>[0], siteId: string) {
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

export interface EjectArgs {
  siteId: string;
  outDir: string;
  /** See export-bundle.ts's own comment — same reasoning applies if this export will be self-hosted. Defaults to no runtime configured (R11: eject still builds fine offline; forms simply decline to submit, same as an unconfigured hosted preview). */
  runtimeApiUrl?: string;
  turnstileSiteKey?: string;
}

export interface EjectResult {
  outDir: string;
}

/**
 * Export tier (c) (ADR-0010): a conventional Astro project, generated from
 * the live site, that builds and runs with `npm install && npm run build`
 * against upstream Astro — no pre-fab package required at runtime (R11).
 */
async function runEject(ctx: Parameters<Command<EjectArgs, EjectResult>["run"]>[0], args: EjectArgs): Promise<EjectResult> {
  const site = await ctx.api.getSite(args.siteId);
  const theme = await ctx.api.getTheme(args.siteId);
  const pageRefs = await ctx.api.listPages(args.siteId);
  const pages = await Promise.all(pageRefs.map((p) => ctx.api.getPage(args.siteId, p.id)));
  const posts = await allPosts(ctx, args.siteId);

  return ejectSite({
    site: {
      id: site.id,
      slug: site.slug,
      name: site.name,
      ownerId: site.ownerId,
      schemaVersion: site.schemaVersion,
      pages: pageRefs.map((p) => ({ id: p.id, slug: p.slug })),
    },
    theme,
    pages,
    posts,
    runtimeApiUrl: args.runtimeApiUrl,
    turnstileSiteKey: args.turnstileSiteKey,
    outDir: args.outDir,
  });
}

export const eject: Command<EjectArgs, EjectResult> = {
  name: "eject",
  description: "Export tier (c) (ADR-0010): generate a standalone Astro project — builds with npm install && npm run build, no pre-fab package required at runtime (R11)",
  run: runEject,
};
