import type { CSSProperties } from "react";
import type { PostDocument } from "@prefab/schema";
import { cssVar, PROSE_MAX_MEASURE } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import { parseMarkdownLite } from "../markdown-lite.js";
import type { PostDetailProps } from "./schema.js";

/** Injected by the publish pipeline's per-post route (@prefab/publish's page-template.ts) — never part of stored props, same as PostList's `posts`. Undefined inside the Puck canvas, which has no single "current post" to show. */
export interface PostDetailRenderProps {
  post?: Pick<PostDocument, "title" | "date" | "author" | "tags" | "cover" | "body">;
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function PostDetail(props: PostDetailProps & BlockRenderProps & PostDetailRenderProps) {
  const { post, blockId, responsive } = props;

  const articleStyle: CSSProperties = {
    padding: `${cssVar("spacing", "section")} ${cssVar("spacing", "element")}`,
    // KAN-1204 (docs/design-audit-2026-09.md §2): same measure cap as
    // RichText — desktop long-form posts ran to ~152 characters/line with no
    // container width constraint at all. See PROSE_MAX_MEASURE's doc comment.
    maxWidth: PROSE_MAX_MEASURE,
    marginLeft: "auto",
    marginRight: "auto",
  };
  const titleStyle: CSSProperties = { fontSize: cssVar("fontSize", "heading"), lineHeight: cssVar("lineHeight", "heading"), margin: 0 };
  const metaStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "sm"),
    lineHeight: cssVar("lineHeight", "sm"),
    color: cssVar("color", "foreground"),
    opacity: 0.7,
    margin: `${cssVar("spacing", "xs")} 0 ${cssVar("spacing", "element")}`,
  };
  const coverStyle: CSSProperties = { width: "100%", borderRadius: cssVar("radius", "card"), margin: `0 0 ${cssVar("spacing", "element")}` };
  const bodyTextStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "body"),
    lineHeight: cssVar("lineHeight", "body"),
    margin: `0 0 ${cssVar("spacing", "sm")}`,
  };

  if (!post) {
    return (
      <article className="pf-block pf-postdetail" style={articleStyle} data-pf-block-type="postdetail" data-pf-block-id={blockId}>
        <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
        <p style={bodyTextStyle}>No post selected.</p>
      </article>
    );
  }

  const blocks = parseMarkdownLite(post.body);

  return (
    <article className="pf-block pf-postdetail" style={articleStyle} data-pf-block-type="postdetail" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      <h1 className="pf-postdetail-title" style={titleStyle}>
        {post.title}
      </h1>
      <div className="pf-postdetail-meta" style={metaStyle}>
        <time dateTime={post.date}>{formatDate(post.date)}</time>
        {post.author ? <span> · {post.author}</span> : null}
        {post.tags.length > 0 ? <span> · {post.tags.join(", ")}</span> : null}
      </div>
      {post.cover ? <img className="pf-postdetail-cover" src={post.cover} alt="" style={coverStyle} /> : null}
      <div className="pf-postdetail-body">
        {blocks.map((block, index) => {
          if (block.kind === "heading") {
            const Tag = (`h${block.level + 1}` as "h2" | "h3" | "h4");
            return (
              <Tag key={index} style={{ ...bodyTextStyle, fontSize: cssVar("fontSize", "lg"), lineHeight: cssVar("lineHeight", "lg") }}>
                {block.text}
              </Tag>
            );
          }
          if (block.kind === "list") {
            return (
              <ul key={index} style={{ ...bodyTextStyle, paddingLeft: "1.25em" }}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            );
          }
          return (
            <p key={index} style={bodyTextStyle}>
              {block.text}
            </p>
          );
        })}
      </div>
    </article>
  );
}
