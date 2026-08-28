import { describe, expect, it } from "vitest";
import { parseMarkdownLite, plainTextExcerpt } from "../src/markdown-lite.js";

describe("parseMarkdownLite", () => {
  it("splits blank-line-separated text into paragraphs", () => {
    expect(parseMarkdownLite("First.\n\nSecond.")).toEqual([
      { kind: "paragraph", text: "First." },
      { kind: "paragraph", text: "Second." },
    ]);
  });

  it("recognises # / ## / ### as headings of level 1/2/3", () => {
    expect(parseMarkdownLite("# One\n\n## Two\n\n### Three")).toEqual([
      { kind: "heading", level: 1, text: "One" },
      { kind: "heading", level: 2, text: "Two" },
      { kind: "heading", level: 3, text: "Three" },
    ]);
  });

  it("groups consecutive -/* lines into one list", () => {
    expect(parseMarkdownLite("- one\n- two\n* three")).toEqual([{ kind: "list", items: ["one", "two", "three"] }]);
  });

  it("joins wrapped paragraph lines with a space", () => {
    expect(parseMarkdownLite("Line one\nline two")).toEqual([{ kind: "paragraph", text: "Line one line two" }]);
  });
});

describe("plainTextExcerpt", () => {
  it("strips heading/list markup and collapses whitespace", () => {
    expect(plainTextExcerpt("# Heading\n\n- item one\n- item two")).toBe("Heading item one item two");
  });

  it("returns the full text unchanged when under the length limit", () => {
    expect(plainTextExcerpt("short text", 160)).toBe("short text");
  });

  it("truncates on a word boundary and appends an ellipsis", () => {
    const long = "word ".repeat(50).trim();
    const excerpt = plainTextExcerpt(long, 20);
    expect(excerpt.length).toBeLessThanOrEqual(21);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).not.toContain("  ");
  });
});
