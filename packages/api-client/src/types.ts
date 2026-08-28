import type { BlockNode, DocumentDiff, PageDocument, ThemeDocument, ThemeTokens } from "@prefab/schema";

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

export type { PageDocument, ThemeDocument, ThemeTokens, BlockNode, DocumentDiff };
