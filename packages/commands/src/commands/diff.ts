import type { DocumentDiff } from "@prefab/schema";
import { diffPageDocuments } from "@prefab/schema";
import type { Command } from "../registry.js";
import { readCheckoutPages, readCheckoutSite } from "../checkout.js";

export interface DiffArgs {
  dir: string;
}

export interface DiffResult {
  site: string;
  pages: Array<{ slug: string; diff: DocumentDiff }>;
}

export const diff: Command<DiffArgs, DiffResult> = {
  name: "diff",
  description: "Show local checkout against the site's current remote state",
  async run(ctx, args) {
    const site = await readCheckoutSite(args.dir);
    const localPages = await readCheckoutPages(args.dir);

    const pages = await Promise.all(
      localPages.map(async (local) => {
        const remote = await ctx.api.getPage(site.id, local.id);
        return { slug: local.slug, diff: diffPageDocuments(remote, local) };
      }),
    );

    return { site: site.slug, pages };
  },
};
