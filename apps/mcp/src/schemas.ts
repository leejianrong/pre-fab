import { z } from "zod";
import { BlockListSchema, PostStatusSchema, ThemeTokensSchema } from "@prefab/schema";

/**
 * MCP tool input shapes — one per command in @prefab/commands' registry.
 * Kept here rather than in packages/commands because arg-shape/protocol
 * translation is exactly what "thin adapter" means (ADR-0003): the CLI
 * translates the same registry into flags, this translates it into MCP
 * tool schemas, and neither owns any mutation logic itself.
 */
export const schemas = {
  "dev.login": { email: z.string().email() },

  "account.signup": { email: z.string().email() },
  "account.verifyEmail": { email: z.string().email(), code: z.string().length(6) },

  "site.create": { slug: z.string().min(1), name: z.string().min(1) },
  "site.list": {},
  "site.get": { siteId: z.string() },

  "template.list": {},
  "site.createFromTemplate": { templateId: z.string().min(1), slug: z.string().min(1), name: z.string().min(1) },

  "domain.add": { siteId: z.string(), hostname: z.string().min(1) },
  "domain.list": { siteId: z.string() },
  "domain.verify": { siteId: z.string(), domainId: z.string() },
  "domain.remove": { siteId: z.string(), domainId: z.string() },

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

  "post.create": {
    siteId: z.string(),
    title: z.string().min(1),
    slug: z.string().min(1).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    author: z.string().optional(),
    tags: z.array(z.string()).optional(),
    cover: z.string().nullable().optional(),
    body: z.string().optional(),
    locale: z.string().optional(),
    status: PostStatusSchema.optional(),
  },
  "post.list": {
    siteId: z.string(),
    limit: z.number().int().optional(),
    offset: z.number().int().optional(),
    status: PostStatusSchema.optional(),
  },
  "post.get": { siteId: z.string(), postId: z.string() },
  "post.write": {
    siteId: z.string(),
    postId: z.string(),
    title: z.string(),
    slug: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    author: z.string(),
    tags: z.array(z.string()),
    cover: z.string().nullable(),
    body: z.string(),
    locale: z.string(),
    status: PostStatusSchema,
    expectedVersion: z.number().int().nonnegative(),
  },

  "form.configure": {
    siteId: z.string(),
    formId: z.string(),
    notifyEmail: z.string().email().nullable().optional(),
    webhookUrl: z.string().url().nullable().optional(),
    webhookSecret: z.string().nullable().optional(),
  },
  "form.get": { siteId: z.string(), formId: z.string() },
  "submission.list": { siteId: z.string(), formId: z.string(), limit: z.number().int().optional(), offset: z.number().int().optional() },
  "submission.export": { siteId: z.string(), formId: z.string(), format: z.enum(["csv", "json"]).optional() },
  "submission.delete": { siteId: z.string(), formId: z.string(), submissionId: z.string() },

  "asset.upload": { siteId: z.string(), filePath: z.string().min(1) },
  "asset.list": { siteId: z.string() },

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

  "member.invite": { siteId: z.string(), email: z.string().email(), role: z.enum(["editor", "viewer"]) },
  "member.list": { siteId: z.string() },
  "member.updateRole": { siteId: z.string(), accountId: z.string(), role: z.enum(["editor", "viewer"]) },
  "member.remove": { siteId: z.string(), accountId: z.string() },

  "subscription.get": {},
  "plan.upgrade": {},
  "plan.cancel": {},

  "availability.set": {
    siteId: z.string(),
    timezone: z.string().min(1),
    weeklyWindows: z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), startMinute: z.number().int(), endMinute: z.number().int() })),
    dateOverrides: z.array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        closed: z.boolean(),
        windows: z.array(z.object({ startMinute: z.number().int(), endMinute: z.number().int() })),
      }),
    ),
    slotDurationMinutes: z.number().int().min(5),
    bufferBeforeMinutes: z.number().int().min(0),
    bufferAfterMinutes: z.number().int().min(0),
    minNoticeMinutes: z.number().int().min(0),
    maxHorizonDays: z.number().int().min(1),
  },
  "availability.get": { siteId: z.string() },

  "booking.list": { siteId: z.string(), limit: z.number().int().optional(), offset: z.number().int().optional(), status: z.enum(["confirmed", "canceled"]).optional() },
  "booking.cancel": { siteId: z.string(), bookingId: z.string() },

  "calendar.connect": { siteId: z.string(), provider: z.enum(["google", "microsoft"]), authorizationCode: z.string().optional(), redirectUri: z.string().optional() },
  "calendar.disconnect": { siteId: z.string() },
  "calendar.status": { siteId: z.string() },

  "export-bundle": {
    siteId: z.string(),
    outDir: z.string(),
    bundleStoreDir: z.string(),
    runtimeApiUrl: z.string().optional(),
    baseUrl: z.string().optional(),
  },
  eject: { siteId: z.string(), outDir: z.string(), runtimeApiUrl: z.string().optional() },
} as const;

export type SchemaCommandName = keyof typeof schemas;
