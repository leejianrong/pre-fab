import { describe, expect, it } from "vitest";
import { newUlid } from "../src/ids.js";
import { createEmptyPost, isPostVisible, validatePostDocument } from "../src/post.js";

describe("createEmptyPost", () => {
  it("starts as a draft at version 0", () => {
    const post = createEmptyPost({ id: newUlid(), siteId: newUlid(), slug: "hello", title: "Hello", date: "2024-01-01" });
    expect(post.status).toBe("draft");
    expect(post.version).toBe(0);
    expect(post.tags).toEqual([]);
  });
});

describe("isPostVisible", () => {
  const now = new Date("2024-06-15T12:00:00Z");

  it("is false for a draft, regardless of date", () => {
    expect(isPostVisible({ status: "draft", date: "2020-01-01" }, now)).toBe(false);
  });

  it("is false for a published post dated in the future (scheduled)", () => {
    expect(isPostVisible({ status: "published", date: "2024-06-16" }, now)).toBe(false);
  });

  it("is true for a published post dated today or in the past", () => {
    expect(isPostVisible({ status: "published", date: "2024-06-15" }, now)).toBe(true);
    expect(isPostVisible({ status: "published", date: "2020-01-01" }, now)).toBe(true);
  });
});

describe("validatePostDocument", () => {
  it("accepts a well-formed post", () => {
    const post = createEmptyPost({ id: newUlid(), siteId: newUlid(), slug: "hello", title: "Hello", date: "2024-01-01" });
    const result = validatePostDocument(post);
    expect(result.ok).toBe(true);
  });

  it("rejects a malformed date with a field-anchored message", () => {
    const post = createEmptyPost({ id: newUlid(), siteId: newUlid(), slug: "hello", title: "Hello", date: "not-a-date" });
    const result = validatePostDocument(post);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path.includes("date"))).toBe(true);
    }
  });

  it("rejects an empty title", () => {
    const post = createEmptyPost({ id: newUlid(), siteId: newUlid(), slug: "hello", title: "", date: "2024-01-01" });
    expect(validatePostDocument(post).ok).toBe(false);
  });
});
