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
