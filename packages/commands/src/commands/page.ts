import type { Command } from "../registry.js";
import type { PageDocument, PageSummary, WritePageInput } from "@prefab/api-client";

export const pageCreate: Command<{ siteId: string; slug: string; title: string }, PageDocument> = {
  name: "page.create",
  mutation: "page.create",
  description: "Create a new, empty page",
  run: (ctx, args) => ctx.api.createPage(args.siteId, { slug: args.slug, title: args.title }),
};

export const pageList: Command<{ siteId: string }, PageSummary[]> = {
  name: "page.list",
  description: "List a site's pages",
  run: (ctx, args) => ctx.api.listPages(args.siteId),
};

export const pageGet: Command<{ siteId: string; pageId: string }, PageDocument> = {
  name: "page.get",
  description: "Get a page document",
  run: (ctx, args) => ctx.api.getPage(args.siteId, args.pageId),
};

export const pageWrite: Command<{ siteId: string; pageId: string } & WritePageInput, PageDocument> = {
  name: "page.write",
  mutation: "page.write",
  description: "Replace a page's title, slug and blocks (whole-document, optimistic-concurrency write — R17/R18)",
  run: (ctx, args) =>
    ctx.api.writePage(args.siteId, args.pageId, {
      title: args.title,
      slug: args.slug,
      blocks: args.blocks,
      expectedVersion: args.expectedVersion,
    }),
};
