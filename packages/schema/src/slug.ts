/**
 * Slug generation for collection content (Slice 5 unit test: "slug
 * generation and collision handling"). Kept pure and framework-free so it
 * is trivially unit-testable and reusable from both the API (auto-slug on
 * post.create) and the file-format round trip.
 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics after NFKD decomposition
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || "post";
}

/**
 * Appends `-2`, `-3`, ... until the slug is not already taken. Never
 * mutates `existing`. Collision handling is a pure function of "what's
 * already there" rather than a database round trip, so it can be unit
 * tested and reused identically wherever a slug needs to be unique
 * (post.create's auto-slug, a hand-edited file re-imported with a
 * duplicate slug).
 */
export function dedupeSlug(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
