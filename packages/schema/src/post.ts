import { z } from "zod";
import { UlidSchema } from "./ids.js";

/** The post document envelope's own format version — independent of any block's schemaVersion (there are no blocks here). */
export const POST_DOCUMENT_SCHEMA_VERSION = 1;

export const PostStatusSchema = z.enum(["draft", "published"]);
export type PostStatus = z.infer<typeof PostStatusSchema>;

/**
 * A blog post (Slice 5): layout/content separation from the block tree
 * (SLICES.md — "first exercise of layout/content separation"). Posts live
 * in their own collection rather than as page blocks, with their own
 * optimistic-concurrency version (ADR-0006/R17), the same write discipline
 * every other mutation gets.
 *
 * `date` (YYYY-MM-DD) is both the post's displayed date and its visibility
 * gate: a post is only ever publicly reachable when `status` is
 * "published" AND `date` is not in the future (see `isPostVisible`) — this
 * is what "scheduled" means here, with no separate field to keep in sync.
 *
 * `locale` is unused in milestone 1 (PLAN.md: "locale-keyed from day one so
 * it is not a migration later").
 */
export const PostDocumentSchema = z.object({
  id: UlidSchema,
  siteId: UlidSchema,
  slug: z.string().min(1),
  title: z.string().min(1),
  schemaVersion: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be an ISO calendar date (YYYY-MM-DD)"),
  author: z.string().default(""),
  tags: z.array(z.string()).default([]),
  cover: z.string().nullable().default(null),
  body: z.string().default(""),
  locale: z.string().min(1).default("en"),
  status: PostStatusSchema.default("draft"),
});

export type PostDocument = z.infer<typeof PostDocumentSchema>;

export function createEmptyPost(input: {
  id: string;
  siteId: string;
  slug: string;
  title: string;
  date: string;
}): PostDocument {
  return {
    id: input.id,
    siteId: input.siteId,
    slug: input.slug,
    title: input.title,
    schemaVersion: POST_DOCUMENT_SCHEMA_VERSION,
    version: 0,
    date: input.date,
    author: "",
    tags: [],
    cover: null,
    body: "",
    locale: "en",
    status: "draft",
  };
}

/**
 * A post is publicly reachable only once it is published AND its date has
 * arrived — a draft or a future-dated ("scheduled") post is never reachable
 * on the live site. Callers filter with this *before* handing posts to the
 * publish pipeline (@prefab/publish never re-derives visibility itself),
 * so "what got built" and "what's visible" can never drift apart.
 */
export function isPostVisible(post: Pick<PostDocument, "status" | "date">, now: Date = new Date()): boolean {
  if (post.status !== "published") return false;
  const today = now.toISOString().slice(0, 10);
  return post.date <= today;
}

export interface PostValidationIssue {
  path: (string | number)[];
  message: string;
}

export type PostValidationResult =
  | { ok: true; issues: []; document: PostDocument }
  | { ok: false; issues: PostValidationIssue[]; document?: undefined };

/** Whole-document validation, same "reject wholesale, name every problem" discipline as page documents (R18) — simpler here since a post has no block registry to migrate against. */
export function validatePostDocument(input: unknown): PostValidationResult {
  const result = PostDocumentSchema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
        message: issue.message,
      })),
    };
  }
  return { ok: true, issues: [], document: result.data };
}
