import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { PostList, postListBlockDefinition, postListDefaultProps, PostListPropsSchema } from "../src/postlist/index.js";

const samplePost = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  slug: "hello-world",
  title: "Hello, world",
  date: "2024-01-05",
  author: "Jane Doe",
  tags: ["news"],
  body: "First paragraph of the post body, long enough to be truncated in an excerpt if the excerpt logic works as intended for this test.",
};

describe("PostList block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(PostList, { ...postListDefaultProps, posts: [samplePost], basePath: "blog" }));
    expect(html).toContain('data-pf-block-type="postlist"');
    expect(html).toContain("Hello, world");
    expect(html).toContain('href="/blog/hello-world"');
  });

  it("renders an empty state with no posts", () => {
    const html = renderToStaticMarkup(createElement(PostList, { ...postListDefaultProps, posts: [] }));
    expect(html).toContain("No posts yet");
  });

  it("renders no posts data at all (inside the Puck canvas) without crashing", () => {
    const html = renderToStaticMarkup(createElement(PostList, postListDefaultProps));
    expect(html).toContain("No posts yet");
  });

  it("hides the excerpt when showExcerpt is false", () => {
    const html = renderToStaticMarkup(
      createElement(PostList, { ...postListDefaultProps, showExcerpt: false, posts: [samplePost], basePath: "blog" }),
    );
    expect(html).not.toContain("pf-postlist-item-excerpt");
  });

  it("shows pagination links only when there is more than one page", () => {
    const single = renderToStaticMarkup(
      createElement(PostList, { ...postListDefaultProps, posts: [samplePost], basePath: "blog", pageNumber: 1, totalPages: 1 }),
    );
    expect(single).not.toContain("pf-postlist-pagination");

    const multi = renderToStaticMarkup(
      createElement(PostList, { ...postListDefaultProps, posts: [samplePost], basePath: "blog", pageNumber: 1, totalPages: 2 }),
    );
    expect(multi).toContain("pf-postlist-pagination");
    expect(multi).toContain("Older");
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(PostList, { ...postListDefaultProps, posts: [samplePost], basePath: "blog" }));
    expect(html).toMatch(/var\(--pf-fontSize-heading\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    expect(PostListPropsSchema.safeParse({ ...postListDefaultProps, color: "#fff" }).success).toBe(false);
  });

  it("props schema clamps postsPerPage to [1, 50]", () => {
    expect(PostListPropsSchema.safeParse({ ...postListDefaultProps, postsPerPage: 0 }).success).toBe(false);
    expect(PostListPropsSchema.safeParse({ ...postListDefaultProps, postsPerPage: 51 }).success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(postListBlockDefinition.version).toBe(1);
    expect(Object.keys(postListBlockDefinition.migrations)).toHaveLength(0);
  });
});
