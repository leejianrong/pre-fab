import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
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
    textAlign: align,
    color: cssVar("color", "foreground"),
    padding: `${cssVar("spacing", "sm")} 0`,
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
