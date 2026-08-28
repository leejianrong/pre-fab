import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { PostDetail, postDetailBlockDefinition, postDetailDefaultProps, PostDetailPropsSchema } from "../src/postdetail/index.js";

const samplePost = {
  title: "Hello, world",
  date: "2024-01-05",
  author: "Jane Doe",
  tags: ["news", "updates"],
  cover: "https://example.com/cover.png",
  body: "# A heading\n\nA paragraph.\n\n- one\n- two",
};

describe("PostDetail block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(PostDetail, { ...postDetailDefaultProps, post: samplePost }));
    expect(html).toContain('data-pf-block-type="postdetail"');
    expect(html).toContain("Hello, world");
    expect(html).toContain("A heading");
    expect(html).toContain("A paragraph.");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain('src="https://example.com/cover.png"');
  });

  it("renders a placeholder with no post selected (inside the Puck canvas)", () => {
    const html = renderToStaticMarkup(createElement(PostDetail, postDetailDefaultProps));
    expect(html).toContain("No post selected");
  });

  it("omits the cover image when the post has none", () => {
    const html = renderToStaticMarkup(createElement(PostDetail, { ...postDetailDefaultProps, post: { ...samplePost, cover: null } }));
    expect(html).not.toContain("pf-postdetail-cover");
  });

  it("never uses dangerouslySetInnerHTML — body content is escaped by React, not parsed as markup", () => {
    const html = renderToStaticMarkup(
      createElement(PostDetail, { ...postDetailDefaultProps, post: { ...samplePost, body: "<script>alert(1)</script>" } }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("props schema accepts no fields (no configurable props)", () => {
    expect(PostDetailPropsSchema.safeParse({}).success).toBe(true);
    expect(PostDetailPropsSchema.safeParse({ anything: true }).success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(postDetailBlockDefinition.version).toBe(1);
    expect(Object.keys(postDetailBlockDefinition.migrations)).toHaveLength(0);
  });
});
