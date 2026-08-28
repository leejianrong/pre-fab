import type { BlockNode, DocumentDiff, FieldDiff, PageDocument, PostDocument, PostStatus, ThemeDocument, ThemeTokens } from "@prefab/schema";

export interface SiteSummary {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PageSummary {
  id: string;
  slug: string;
  title: string;
}

export interface CreateSiteResult {
  site: SiteSummary;
  page: PageDocument;
}

export interface TemplateSummary {
  id: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
}

export interface CreateSiteFromTemplateResult {
  site: SiteSummary;
  pages: PageDocument[];
  templateId: string;
}

export interface SignupResult {
  accountId: string;
  status: "pending_verification";
}

export type CustomDomainStatus = "pending_dns" | "active" | "failed";

export interface CustomDomain {
  id: string;
  siteId: string;
  hostname: string;
  isApex: boolean;
  status: CustomDomainStatus;
  providerHostnameId: string | null;
  cnameTarget: string;
  verificationError: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface DnsInstruction {
  recordType: "CNAME" | "ALIAS/ANAME";
  name: string;
  value: string;
  note: string;
}

export interface DomainWithInstruction {
  domain: CustomDomain;
  dnsInstruction: DnsInstruction;
}

export interface VerifyEmailResult {
  accountId: string;
}

export interface IssuedApiToken {
  id: string;
  name: string;
  /** Shown once, at mint time — never retrievable again. */
  token: string;
  expiresAt: string;
}

export interface SiteOutline {
  site: { id: string; slug: string; name: string };
  pages: Array<{
    id: string;
    slug: string;
    title: string;
    blocks: Array<{ id: string; type: string; summary: string }>;
  }>;
}

export interface PublishRecord {
  id: string;
  siteId: string;
  bundlePath: string;
  contentHash: string;
  isLive: boolean;
  createdAt: string;
  createdBy: string;
}

export interface PublishResult {
  publish: PublishRecord;
  liveUrl: string;
}

export interface PreviewResult {
  contentHash: string;
  previewUrl: string;
}

export interface WritePageInput {
  title: string;
  slug: string;
  blocks: BlockNode[];
  expectedVersion: number;
}

/** Mirrors apps/api's 409 conflict payload (R17) exactly. */
export interface ConflictDetails {
  current: PageDocument;
  diff: DocumentDiff;
}

// ---- posts (Slice 5) ----

export interface CreatePostInput {
  title: string;
  slug?: string;
  date?: string;
  author?: string;
  tags?: string[];
  cover?: string | null;
  body?: string;
  locale?: string;
  status?: PostStatus;
}

export interface WritePostInput {
  title: string;
  slug: string;
  date: string;
  author: string;
  tags: string[];
  cover: string | null;
  body: string;
  locale: string;
  status: PostStatus;
  expectedVersion: number;
}

export interface ListPostsQuery {
  limit?: number;
  offset?: number;
  status?: PostStatus;
}

export interface ListPostsResult {
  posts: PostDocument[];
  total: number;
}

/** Mirrors apps/api's post.write 409 conflict payload — a plain field diff, since a post has no block tree to diff (unlike page.write's ConflictDetails). */
export interface PostConflictDetails {
  current: PostDocument;
  diff: FieldDiff[];
}

export interface AssetVariant {
  width: number;
  key: string;
}

export interface Asset {
  id: string;
  siteId: string;
  sha256: string;
  contentType: string;
  byteSize: number;
  filename: string;
  width: number | null;
  height: number | null;
  variants: AssetVariant[];
  createdAt: string;
  createdBy: string;
}

export interface UploadAssetInput {
  filename: string;
  contentType: string;
  dataBase64: string;
}

// ---- forms and submissions (Slice 6) ----

export type FormFieldType = "text" | "email" | "textarea" | "select" | "checkbox" | "file";

export interface FormField {
  type: FormFieldType;
  label: string;
  name: string;
  required: boolean;
  /** One option per line — only meaningful for `type: "select"`. */
  options?: string;
}

export interface FormManifest {
  id: string;
  siteId: string;
  heading: string;
  fields: FormField[];
  submitLabel: string;
  turnstileEnabled: boolean;
}

export interface FormSettings {
  formId: string;
  siteId: string;
  notifyEmail: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
}

export interface ConfigureFormInput {
  notifyEmail?: string | null;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
}

export interface FormWithSettings {
  form: FormManifest | null;
  settings: FormSettings | null;
}

export interface Submission {
  id: string;
  siteId: string;
  formId: string;
  values: Record<string, unknown>;
  ip: string | null;
  notifyStatus: "skipped" | "sent" | "failed";
  notifyError: string | null;
  createdAt: string;
}

export interface ListSubmissionsQuery {
  limit?: number;
  offset?: number;
}

export interface ListSubmissionsResult {
  submissions: Submission[];
  total: number;
}

export type { PageDocument, PostDocument, PostStatus, ThemeDocument, ThemeTokens, BlockNode, DocumentDiff, FieldDiff };
