import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { MapEmbedProps } from "./schema.js";

/**
 * Layout pixel heights for the embed — a structural dimension, not a
 * color/spacing/type value the theme token scale governs (same exception
 * Hero and Button already take for their literal button padding).
 */
const HEIGHT_PX: Record<MapEmbedProps["height"], number> = {
  sm: 300,
  md: 400,
  lg: 520,
};

const placeholderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: cssVar("color", "muted"),
  color: cssVar("color", "muted-foreground"),
  borderRadius: cssVar("radius", "card"),
  fontSize: cssVar("fontSize", "sm"),
};

export function MapEmbed(props: MapEmbedProps & BlockRenderProps) {
  const { query, height, blockId, responsive } = props;
  const heightPx = HEIGHT_PX[height];

  return (
    <div className="pf-block pf-mapembed" data-pf-block-type="mapembed" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      {query ? (
        <iframe
          className="pf-mapembed-frame"
          src={`https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`}
          loading="lazy"
          title="Map"
          style={{ width: "100%", height: `${heightPx}px`, border: "none" }}
        />
      ) : (
        <div
          className="pf-mapembed-placeholder"
          style={{ ...placeholderStyle, height: `${heightPx}px` }}
        >
          No location set
        </div>
      )}
    </div>
  );
}
