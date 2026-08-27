import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { ImageProps } from "./schema.js";

export function Image(props: ImageProps & BlockRenderProps) {
  const { src, alt, caption, radius, blockId, responsive } = props;

  // width/height here are structural layout keywords (percentage/auto), not
  // a raw color/spacing/typography/radius value — see hero/Hero.tsx and
  // button/Button.tsx for the same treatment of non-token structural CSS.
  const imgStyle: CSSProperties = {
    width: "100%",
    height: "auto",
    display: "block",
    ...(radius === "none" ? {} : { borderRadius: cssVar("radius", radius) }),
  };

  const captionStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "sm"),
    color: cssVar("color", "muted-foreground"),
    padding: `${cssVar("spacing", "xs")} 0 0`,
    margin: 0,
  };

  return (
    <figure
      className="pf-block pf-image"
      style={{ margin: 0 }}
      data-pf-block-type="image"
      data-pf-block-id={blockId}
    >
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      <img className="pf-image-img" src={src} alt={alt} style={imgStyle} />
      {caption ? (
        <figcaption className="pf-image-caption" style={captionStyle}>
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
