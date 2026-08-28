import type { Command } from "../registry.js";
import type { CreateSiteFromTemplateResult, TemplateSummary } from "@prefab/api-client";

export const templateList: Command<Record<string, never>, TemplateSummary[]> = {
  name: "template.list",
  description: "List the templates available to fork a new site from (ADR-0011)",
  run: (ctx) => ctx.api.listTemplates(),
};

export const siteCreateFromTemplate: Command<
  { templateId: string; slug: string; name: string },
  CreateSiteFromTemplateResult
> = {
  name: "site.createFromTemplate",
  mutation: "site.createFromTemplate",
  description: "Fork a template into a new site — every page and block gets a fresh id (ADR-0011)",
  run: (ctx, args) => ctx.api.createSiteFromTemplate(args.templateId, { slug: args.slug, name: args.name }),
};
