import type { Command } from "../registry.js";
import type { CreateSiteResult, SiteSummary } from "@prefab/api-client";

export const siteCreate: Command<{ slug: string; name: string }, CreateSiteResult> = {
  name: "site.create",
  mutation: "site.create",
  description: "Create a new site, seeded with a default home page and Hero block",
  run: (ctx, args) => ctx.api.createSite(args),
};

export const siteList: Command<Record<string, never>, SiteSummary[]> = {
  name: "site.list",
  description: "List sites you own",
  run: (ctx) => ctx.api.listSites(),
};

export const siteGet: Command<{ siteId: string }, SiteSummary> = {
  name: "site.get",
  description: "Get a site by id",
  run: (ctx, args) => ctx.api.getSite(args.siteId),
};
