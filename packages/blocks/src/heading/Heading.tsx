import { createElement, type CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { HeadingProps } from "./schema.js";

export function Heading(props: HeadingProps & BlockRenderProps) {
  const { text, level, size, align, blockId, responsive } = props;

  const style: CSSProperties = {
    fontSize: cssVar("fontSize", size),
    fontFamily: cssVar("fontFamily", "heading"),
    textAlign: align,
    margin: 0,
    padding: `${cssVar("spacing", "sm")} 0`,
    color: cssVar("color", "foreground"),
  };

  return (
    <div className="pf-block pf-heading" data-pf-block-type="heading" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      {createElement(level, { className: "pf-heading-text", style }, text)}
    </div>
  );
}
