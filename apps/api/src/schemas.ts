import { z } from "zod";
import { BlockListSchema, ThemeTokensSchema } from "@prefab/schema";

export const CreateSiteBodySchema = z.object({
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
});

export const UpdateThemeBodySchema = z.object({
  tokens: ThemeTokensSchema,
});

export const CreatePageBodySchema = z.object({
  slug: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
});

export const WritePageBodySchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(64),
  blocks: BlockListSchema,
  expectedVersion: z.number().int().nonnegative(),
});

export const CreateTokenBodySchema = z.object({
  name: z.string().min(1).max(120),
});

export const DevLoginBodySchema = z.object({
  email: z.string().email(),
});
