import { describe, expect, it } from "vitest";
import { dedupeSlug, slugify } from "../src/slug.js";

describe("slugify", () => {
  it("lowercases, strips diacritics, and hyphenates non-alphanumerics", () => {
    expect(slugify("Café Life: A Résumé!")).toBe("cafe-life-a-resume");
  });

  it("collapses runs of separators and trims leading/trailing hyphens", () => {
    expect(slugify("  Hello,   World!!  ")).toBe("hello-world");
  });

  it("falls back to 'post' when nothing alphanumeric survives", () => {
    expect(slugify("!!! ??? ---")).toBe("post");
    expect(slugify("")).toBe("post");
  });

  it("truncates very long titles to a bounded length", () => {
    const long = "word ".repeat(50);
    expect(slugify(long).length).toBeLessThanOrEqual(96);
  });
});

describe("dedupeSlug", () => {
  it("returns the base slug unchanged when it isn't taken", () => {
    expect(dedupeSlug("hello-world", [])).toBe("hello-world");
    expect(dedupeSlug("hello-world", ["something-else"])).toBe("hello-world");
  });

  it("appends -2 when the base slug is already taken", () => {
    expect(dedupeSlug("hello-world", ["hello-world"])).toBe("hello-world-2");
  });

  it("finds the first free numeric suffix across multiple collisions", () => {
    expect(dedupeSlug("hello-world", ["hello-world", "hello-world-2", "hello-world-3"])).toBe("hello-world-4");
  });

  it("does not mutate the existing collection", () => {
    const existing = ["hello-world"];
    dedupeSlug("hello-world", existing);
    expect(existing).toEqual(["hello-world"]);
  });
});
