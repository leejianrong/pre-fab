import { describe, expect, it } from "vitest";
import { newUlid } from "../src/ids.js";
import { createEmptyPost, type PostDocument } from "../src/post.js";
import { parsePostFile, PostFileParseError, serializePostFile } from "../src/post-file.js";

function samplePost(overrides: Partial<PostDocument> = {}): PostDocument {
  return {
    ...createEmptyPost({ id: newUlid(), siteId: newUlid(), slug: "hello-world", title: "Hello, World: a start", date: "2024-01-05" }),
    author: "Jane Doe",
    tags: ["news", "updates"],
    cover: "https://example.com/cover.png",
    status: "published",
    body: "First paragraph.\n\nSecond paragraph with more text.",
    ...overrides,
  };
}

describe("post file round trip (Slice 5 unit test: rich-text to file-format round-trip fidelity)", () => {
  it("serializes then parses back to an identical document", () => {
    const post = samplePost();
    const file = parsePostFile(serializePostFile(post));
    expect(file).toEqual(post);
  });

  it("round-trips a post with no tags, no cover, and a draft status", () => {
    const post = samplePost({ tags: [], cover: null, status: "draft" });
    expect(parsePostFile(serializePostFile(post))).toEqual(post);
  });

  it("round-trips a title containing a colon", () => {
    const post = samplePost({ title: "My Post: A Subtitle" });
    expect(parsePostFile(serializePostFile(post))).toEqual(post);
  });

  it("round-trips a multi-paragraph body with no trailing blank lines added or lost", () => {
    const post = samplePost({ body: "# Heading\n\nSome text.\n\n- one\n- two" });
    expect(parsePostFile(serializePostFile(post))).toEqual(post);
  });

  it("produces a human-editable frontmatter block", () => {
    const file = serializePostFile(samplePost());
    expect(file).toMatch(/^---\n/);
    expect(file).toContain("title: Hello, World: a start");
    expect(file).toContain("tags: news, updates");
    expect(file).toContain("status: published");
  });

  it("rejects a file missing the frontmatter delimiter", () => {
    expect(() => parsePostFile("title: no delimiter\n\nbody")).toThrow(PostFileParseError);
  });

  it("rejects a file missing a required field", () => {
    const brokenFile = "---\nid: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n---\n\nbody";
    expect(() => parsePostFile(brokenFile)).toThrow(/missing required field/);
  });
});
