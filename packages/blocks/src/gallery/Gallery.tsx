import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { IntrinsicGridFallback, ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { GalleryProps } from "./schema.js";

// KAN-1204 (docs/design-audit-2026-09.md §5): same built-in mobile column
// fallback as CardGrid — see IntrinsicGridFallback's own doc comment.
// Gallery has no title/body text to overflow, but a fixed `columns:3` at
// 375px still squeezes every image into the same ~77px-wide track CardGrid's
// cards did, which is exactly as un-intentional here.
const MOBILE_MIN_IMAGE_PX = 140;

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
      <IntrinsicGridFallback className="pf-gallery" minTrackPx={MOBILE_MIN_IMAGE_PX} />
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
