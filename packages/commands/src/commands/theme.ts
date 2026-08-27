import type { Command } from "../registry.js";
import type { ThemeDocument, ThemeTokens } from "@prefab/api-client";

export const themeGet: Command<{ siteId: string }, ThemeDocument> = {
  name: "theme.get",
  description: "Get a site's theme tokens",
  run: (ctx, args) => ctx.api.getTheme(args.siteId),
};

export const themeSet: Command<{ siteId: string; tokens: ThemeTokens }, ThemeDocument> = {
  name: "theme.set",
  mutation: "theme.update",
  description: "Replace a site's theme tokens",
  run: (ctx, args) => ctx.api.updateTheme(args.siteId, args.tokens),
};
