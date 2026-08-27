import { z } from "zod";
import { BlockListSchema, ThemeTokensSchema } from "@prefab/schema";

/**
 * MCP tool input shapes — one per command in @prefab/commands' registry.
 * Kept here rather than in packages/commands because arg-shape/protocol
 * translation is exactly what "thin adapter" means (ADR-0003): the CLI
 * translates the same registry into flags, this translates it into MCP
 * tool schemas, and neither owns any mutation logic itself.
 */
export const schemas = {
  "dev.login": { email: z.string().email() },

  "site.create": { slug: z.string().min(1), name: z.string().min(1) },
  "site.list": {},
  "site.get": { siteId: z.string() },

  "theme.get": { siteId: z.string() },
  "theme.set": { siteId: z.string(), tokens: ThemeTokensSchema },

  "page.create": { siteId: z.string(), slug: z.string().min(1), title: z.string().min(1) },
  "page.list": { siteId: z.string() },
  "page.get": { siteId: z.string(), pageId: z.string() },
  "page.write": {
    siteId: z.string(),
    pageId: z.string(),
    title: z.string(),
    slug: z.string(),
    blocks: BlockListSchema,
    expectedVersion: z.number().int().nonnegative(),
  },

  "token.create": { siteId: z.string(), name: z.string().min(1) },

  "site.outline": { siteId: z.string() },

  "publish.create": { siteId: z.string() },
  "publish.rollback": { siteId: z.string(), publishId: z.string() },
  "publish.list": { siteId: z.string() },

  pull: { siteId: z.string(), dir: z.string() },
  export: { siteId: z.string(), dir: z.string() },
  push: { dir: z.string() },
  import: { dir: z.string() },
  diff: { dir: z.string() },
  build: { dir: z.string(), bundleStoreDir: z.string() },
  preview: { dir: z.string(), bundleStoreDir: z.string(), screenshot: z.boolean().optional() },
} as const;

export type SchemaCommandName = keyof typeof schemas;
