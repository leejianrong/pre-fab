import type { Command } from "../registry.js";
import type { SiteOutline } from "@prefab/api-client";

export const siteOutline: Command<{ siteId: string }, SiteOutline> = {
  name: "site.outline",
  description: "Every page and block as a compact tree of ids, types and one-line summaries — orient in one call (R14)",
  run: (ctx, args) => ctx.api.getOutline(args.siteId),
};
