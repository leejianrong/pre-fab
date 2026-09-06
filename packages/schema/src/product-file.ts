import type { FulfillmentType, ProductDocument, ProductStatus } from "./product.js";
import { PRODUCT_DOCUMENT_SCHEMA_VERSION } from "./product.js";

/**
 * The file-tree projection's format for a product (ADR-0018 question 4:
 * products are owner-authored, exportable site content, following posts'
 * exact precedent) — frontmatter + a Markdown description, the same shape
 * `post-file.ts` already uses. See that file's own module comment for why
 * this is a small, fixed key set rather than real YAML: each line is
 * `key: value`, split on the *first* colon, `images` is a single
 * comma-separated line (same convention `tags` already uses), `---`
 * delimiters, Markdown description after.
 */
const FRONTMATTER_DELIMITER = "---";

const FIELD_ORDER = [
  "id",
  "siteId",
  "slug",
  "title",
  "price",
  "currency",
  "fulfillmentType",
  "stockCount",
  "images",
  "successMessage",
  "status",
  "schemaVersion",
  "version",
] as const;

function serializeValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return value === null || value === undefined ? "" : String(value);
}

export function serializeProductFile(product: ProductDocument): string {
  const fields: Record<string, unknown> = { ...product };
  const lines = FIELD_ORDER.map((key) => `${key}: ${serializeValue(fields[key])}`);
  return `${FRONTMATTER_DELIMITER}\n${lines.join("\n")}\n${FRONTMATTER_DELIMITER}\n\n${product.description}\n`;
}

class ProductFileParseError extends Error {
  constructor(message: string) {
    super(`invalid product file: ${message}`);
    this.name = "ProductFileParseError";
  }
}

function parseFrontmatterLines(lines: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of lines) {
    if (line.trim() === "") continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) throw new ProductFileParseError(`malformed frontmatter line: "${line}"`);
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    fields[key] = value;
  }
  return fields;
}

function requireField(fields: Record<string, string>, key: string): string {
  const value = fields[key];
  if (value === undefined) throw new ProductFileParseError(`missing required field "${key}"`);
  return value;
}

function parseImages(value: string | undefined): string[] {
  if (!value || value.trim() === "") return [];
  return value
    .split(",")
    .map((src) => src.trim())
    .filter((src) => src.length > 0);
}

function parseInt10(value: string, field: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new ProductFileParseError(`field "${field}" must be an integer, got "${value}"`);
  return parsed;
}

function parseNullableInt(value: string | undefined, field: string): number | null {
  if (value === undefined || value.trim() === "") return null;
  return parseInt10(value, field);
}

/**
 * Inverse of `serializeProductFile`. Throws `ProductFileParseError` on
 * structural problems (missing delimiter, malformed line, an unparseable
 * integer field) rather than silently defaulting — the same discipline
 * `parsePostFile` already documents.
 */
export function parseProductFile(raw: string): ProductDocument {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    throw new ProductFileParseError("must start with a --- frontmatter delimiter");
  }
  const afterOpen = normalized.slice(FRONTMATTER_DELIMITER.length + 1);
  const closeIndex = afterOpen.indexOf(`\n${FRONTMATTER_DELIMITER}\n`);
  if (closeIndex === -1) throw new ProductFileParseError("missing closing --- frontmatter delimiter");

  const frontmatterBlock = afterOpen.slice(0, closeIndex);
  const description = afterOpen.slice(closeIndex + FRONTMATTER_DELIMITER.length + 2).replace(/^\n+/, "");
  const fields = parseFrontmatterLines(frontmatterBlock.split("\n"));

  return {
    id: requireField(fields, "id"),
    siteId: requireField(fields, "siteId"),
    slug: requireField(fields, "slug"),
    title: requireField(fields, "title"),
    price: parseInt10(requireField(fields, "price"), "price"),
    currency: fields.currency ?? "usd",
    fulfillmentType: (fields.fulfillmentType as FulfillmentType | undefined) ?? "physical",
    stockCount: parseNullableInt(fields.stockCount, "stockCount"),
    images: parseImages(fields.images),
    successMessage: fields.successMessage ?? "Thank you for your purchase.",
    status: (fields.status as ProductStatus | undefined) ?? "draft",
    schemaVersion: fields.schemaVersion ? parseInt10(fields.schemaVersion, "schemaVersion") : PRODUCT_DOCUMENT_SCHEMA_VERSION,
    version: fields.version ? parseInt10(fields.version, "version") : 0,
    description: description.replace(/\n+$/, ""),
  };
}

export { ProductFileParseError };
