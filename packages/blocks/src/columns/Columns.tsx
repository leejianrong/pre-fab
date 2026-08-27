import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { ColumnsProps } from "./schema.js";

export function Columns(props: ColumnsProps & BlockRenderProps) {
  const { count, gap, blockId, responsive } = props;

  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${count}, minmax(0,1fr))`,
    gap: cssVar("spacing", gap),
  };

  // True nested child slots (Puck zones, per ADR-0002/PLAN.md mechanism 1)
  // are a follow-up — this slice renders `count` empty placeholder cells
  // rather than a real parent/order child tree.
  return (
    <div
      className="pf-block pf-columns"
      style={gridStyle}
      data-pf-block-type="columns"
      data-pf-block-id={blockId}
      data-pf-columns-block=""
    >
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} naturalDisplay="grid" />
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="pf-column" />
      ))}
    </div>
  );
}
