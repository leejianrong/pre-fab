import { z } from "zod";
import { BlockListSchema, PostStatusSchema, ThemeTokensSchema } from "@prefab/schema";

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

// ---- posts (Slice 5) ----
// `slug` and `date` are optional: an omitted slug is auto-generated from
// `title` (deduped against the site's existing posts), and an omitted date
// defaults to today — the common case of "I'm writing this post now."
export const CreatePostBodySchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(96).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .optional(),
  author: z.string().max(120).optional(),
  tags: z.array(z.string().max(60)).optional(),
  cover: z.string().max(2048).nullable().optional(),
  body: z.string().max(200_000).optional(),
  locale: z.string().min(1).max(35).optional(),
  status: PostStatusSchema.optional(),
});

export const WritePostBodySchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(96),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  author: z.string().max(120).default(""),
  tags: z.array(z.string().max(60)).default([]),
  cover: z.string().max(2048).nullable().default(null),
  body: z.string().max(200_000).default(""),
  locale: z.string().min(1).max(35).default("en"),
  status: PostStatusSchema.default("draft"),
  expectedVersion: z.number().int().nonnegative(),
});

export const ListPostsQuerySchema = z.object({
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
  status: PostStatusSchema.optional(),
});

export const CreateTokenBodySchema = z.object({
  name: z.string().min(1).max(120),
});

// Base64 grows input by ~4/3 — this coarsely bounds decoded size to 8 MiB
// before the handler decodes anything; the exact byte count is re-checked
// against the same 8 MiB cap after decoding.
const MAX_BASE64_LENGTH = Math.ceil((8 * 1024 * 1024 * 4) / 3);

export const UploadAssetBodySchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  dataBase64: z.string().min(1).max(MAX_BASE64_LENGTH),
});

export const DevLoginBodySchema = z.object({
  email: z.string().email(),
});

export const SignupBodySchema = z.object({
  email: z.string().email(),
});

export const VerifyEmailBodySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

export const CreateSiteFromTemplateBodySchema = z.object({
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
});

export const AddDomainBodySchema = z.object({
  hostname: z.string().min(1).max(253),
});

/** Dev-only (see `/v1/dev/domains/:providerHostnameId/advance`) — drives the FakeDomainProvider the same way real DNS propagation completing (or failing) would. */
export const AdvanceFakeDomainBodySchema = z.object({
  status: z.enum(["pending", "active", "failed"]),
  verificationErrors: z.array(z.string()).optional(),
});

// ---- forms and submissions (Slice 6) ----
// A blank string clears the setting (an owner turning notification or
// webhook delivery back off) rather than being rejected — `.nullable()`
// so a caller can also send an explicit `null` for the same effect.
export const ConfigureFormBodySchema = z.object({
  notifyEmail: z.string().email().max(320).nullable().optional(),
  webhookUrl: z.string().url().max(2048).nullable().optional(),
  webhookSecret: z.string().max(200).nullable().optional(),
});

export const ListSubmissionsQuerySchema = z.object({
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
});

export const ExportSubmissionsQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
});

/**
 * The runtime API's own submit body — deliberately loose (`z.record`, not
 * per-field validation): field-shape validation is @prefab/runtime's job
 * (validateSubmissionValues, checked against the form's own manifest,
 * where the field types actually live), not this route's. This schema
 * only guards the wire shape before it ever reaches that logic.
 */
export const SubmitFormBodySchema = z.object({
  values: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
  turnstileToken: z.string().max(4096).optional(),
});

// ---- Slice 8: accounts, plans and billing (ADR-0005, ADR-0012) ----
const SiteRoleSchema = z.enum(["editor", "viewer"]);

export const InviteMemberBodySchema = z.object({
  email: z.string().email(),
  role: SiteRoleSchema,
});

export const UpdateMemberRoleBodySchema = z.object({
  role: SiteRoleSchema,
});

export const UpgradePlanBodySchema = z.object({
  plan: z.literal("pro"),
});

/** Dev-only (see `/v1/dev/stripe/:accountId/advance`) — drives the FakeStripeProvider the same way real Stripe webhook delivery would. */
export const AdvanceFakeStripeBodySchema = z.object({
  event: z.enum(["checkout_completed", "payment_failed", "payment_succeeded", "canceled"]),
});
