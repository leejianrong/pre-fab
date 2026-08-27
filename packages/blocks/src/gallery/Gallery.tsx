import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { GalleryProps } from "./schema.js";

export function Gallery(props: GalleryProps & BlockRenderProps) {
  const { images, columns, blockId, responsive } = props;

  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`,
    gap: cssVar("spacing", "sm"),
  };

  return (
    <div className="pf-block pf-gallery" style={gridStyle} data-pf-block-type="gallery" data-pf-block-id={blockId}>
      {/* columnsProperty is what lets the responsive `columns` override actually
          repaint this grid's column count — see responsive.tsx's docblock. */}
      <ResponsiveStyle
        blockId={blockId ?? ""}
        responsive={responsive ?? {}}
        naturalDisplay="grid"
        columnsProperty="grid-template-columns"
      />
      {images.map((image, index) => (
        <img
          key={index}
          className="pf-gallery-img"
          src={image.src}
          alt={image.alt}
          style={{ width: "100%", height: "auto", display: "block", borderRadius: cssVar("radius", "card") }}
        />
      ))}
    </div>
  );
}
