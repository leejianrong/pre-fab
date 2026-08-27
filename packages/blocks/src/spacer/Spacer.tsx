import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { SpacerProps } from "./schema.js";

export function Spacer(props: SpacerProps & BlockRenderProps) {
  const { height, blockId, responsive } = props;

  const style: CSSProperties = {
    height: cssVar("spacing", height),
  };

  return (
    <div className="pf-block pf-spacer" style={style} data-pf-block-type="spacer" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
    </div>
  );
}
