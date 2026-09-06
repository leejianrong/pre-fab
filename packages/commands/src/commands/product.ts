import type { Command } from "../registry.js";
import type { CreateProductInput, ListProductsQuery, ListProductsResult, ProductDocument, WriteProductInput } from "@prefab/api-client";

export const productCreate: Command<{ siteId: string } & CreateProductInput, ProductDocument> = {
  name: "product.create",
  mutation: "product.create",
  description: "Create a new catalogue product — an omitted slug is generated from the title (KAN-1244 / ADR-0018)",
  run: (ctx, args) => {
    const { siteId, ...input } = args;
    return ctx.api.createProduct(siteId, input);
  },
};

export const productList: Command<{ siteId: string } & ListProductsQuery, ListProductsResult> = {
  name: "product.list",
  description: "List a site's catalogue products, paginated",
  run: (ctx, args) => {
    const { siteId, ...query } = args;
    return ctx.api.listProducts(siteId, query);
  },
};

export const productGet: Command<{ siteId: string; productId: string }, ProductDocument> = {
  name: "product.get",
  description: "Get a catalogue product document",
  run: (ctx, args) => ctx.api.getProduct(args.siteId, args.productId),
};

export const productWrite: Command<{ siteId: string; productId: string } & WriteProductInput, ProductDocument> = {
  name: "product.write",
  mutation: "product.write",
  description: "Replace a catalogue product's fields (whole-document, optimistic-concurrency write — R17/R18)",
  run: (ctx, args) => {
    const { siteId, productId, ...input } = args;
    return ctx.api.writeProduct(siteId, productId, input);
  },
};
