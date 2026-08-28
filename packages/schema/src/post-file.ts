import type { PostDocument, PostStatus } from "./post.js";
import { POST_DOCUMENT_SCHEMA_VERSION } from "./post.js";

/**
 * The file-tree projection's format for a post (SLICES.md: "a file
 * representation that is pleasant to edit by hand") — frontmatter + a
 * Markdown body, the same shape a static-site author already expects from
 * Jekyll/Hugo/Astro content collections, rather than the raw indented JSON
 * `pages/*.json` uses. Deliberately a small, fixed key set (not real YAML —
 * no dependency needed, and no ambiguity to round-trip around): each line is
 * `key: value`, split on the *first* colon so a title containing one is
 * still safe, and `tags` is a single comma-separated line.
 */
const FRONTMATTER_DELIMITER = "---";

const FIELD_ORDER = [
  "id",
  "siteId",
  "slug",
  "title",
  "date",
  "author",
  "tags",
  "cover",
  "locale",
  "status",
  "schemaVersion",
  "version",
] as const;

function serializeValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return value === null || value === undefined ? "" : String(value);
}

export function serializePostFile(post: PostDocument): string {
  const fields: Record<string, unknown> = { ...post };
  const lines = FIELD_ORDER.map((key) => `${key}: ${serializeValue(fields[key])}`);
  return `${FRONTMATTER_DELIMITER}\n${lines.join("\n")}\n${FRONTMATTER_DELIMITER}\n\n${post.body}\n`;
}

class PostFileParseError extends Error {
  constructor(message: string) {
    super(`invalid post file: ${message}`);
    this.name = "PostFileParseError";
  }
}

function parseFrontmatterLines(lines: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of lines) {
    if (line.trim() === "") continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) throw new PostFileParseError(`malformed frontmatter line: "${line}"`);
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    fields[key] = value;
  }
  return fields;
}

function requireField(fields: Record<string, string>, key: string): string {
  const value = fields[key];
  if (value === undefined) throw new PostFileParseError(`missing required field "${key}"`);
  return value;
}

function parseTags(value: string | undefined): string[] {
  if (!value || value.trim() === "") return [];
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function parseInt10(value: string, field: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new PostFileParseError(`field "${field}" must be an integer, got "${value}"`);
  return parsed;
}

/**
 * Inverse of `serializePostFile`. Throws `PostFileParseError` on structural
 * problems (missing delimiter, malformed line) rather than silently
 * defaulting — a hand-edited file that's missing a frontmatter field is a
 * mistake worth surfacing, not guessing through.
 */
export function parsePostFile(raw: string): PostDocument {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    throw new PostFileParseError("must start with a --- frontmatter delimiter");
  }
  const afterOpen = normalized.slice(FRONTMATTER_DELIMITER.length + 1);
  const closeIndex = afterOpen.indexOf(`\n${FRONTMATTER_DELIMITER}\n`);
  if (closeIndex === -1) throw new PostFileParseError("missing closing --- frontmatter delimiter");

  const frontmatterBlock = afterOpen.slice(0, closeIndex);
  const body = afterOpen.slice(closeIndex + FRONTMATTER_DELIMITER.length + 2).replace(/^\n+/, "");
  const fields = parseFrontmatterLines(frontmatterBlock.split("\n"));

  return {
    id: requireField(fields, "id"),
    siteId: requireField(fields, "siteId"),
    slug: requireField(fields, "slug"),
    title: requireField(fields, "title"),
    date: requireField(fields, "date"),
    author: fields.author ?? "",
    tags: parseTags(fields.tags),
    cover: fields.cover && fields.cover !== "" ? fields.cover : null,
    locale: fields.locale ?? "en",
    status: (fields.status as PostStatus | undefined) ?? "draft",
    schemaVersion: fields.schemaVersion ? parseInt10(fields.schemaVersion, "schemaVersion") : POST_DOCUMENT_SCHEMA_VERSION,
    version: fields.version ? parseInt10(fields.version, "version") : 0,
    body: body.replace(/\n+$/, ""),
  };
}

export { PostFileParseError };
