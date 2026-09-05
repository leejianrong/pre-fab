import type { CSSProperties } from "react";
import { cssVar, PROSE_MAX_MEASURE } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { RichTextProps } from "./schema.js";

export function RichText(props: RichTextProps & BlockRenderProps) {
  const { html, size, align, blockId, responsive } = props;

  const paragraphs = html
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const style: CSSProperties = {
    fontSize: cssVar("fontSize", size),
    lineHeight: cssVar("lineHeight", size),
    textAlign: align,
    color: cssVar("color", "foreground"),
    padding: `${cssVar("spacing", "sm")} 0`,
    // KAN-1204 (docs/design-audit-2026-09.md §2): desktop paragraphs ran to
    // ~152 characters/line with nothing constraining container width —
    // capped to a readable measure regardless of how wide the page/column
    // around this block is. Centered so a left-aligned paragraph still
    // reads as an intentional column, not a box hugging the left edge of
    // whatever's wider than it (see PROSE_MAX_MEASURE's own doc comment).
    maxWidth: PROSE_MAX_MEASURE,
    marginLeft: "auto",
    marginRight: "auto",
  };

  return (
    <div className="pf-block pf-richtext" style={style} data-pf-block-type="richtext" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="pf-richtext-paragraph" style={{ margin: 0, padding: `${cssVar("spacing", "xs")} 0` }}>
          {paragraph}
        </p>
      ))}
    </div>
  );
}
