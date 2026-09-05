import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { TestimonialProps } from "./schema.js";

export function Testimonial(props: TestimonialProps & BlockRenderProps) {
  const { quote, author, role, blockId, responsive } = props;

  const quoteStyle: CSSProperties = {
    background: cssVar("color", "surface"),
    color: cssVar("color", "surface-foreground"),
    borderRadius: cssVar("radius", "card"),
    padding: cssVar("spacing", "element"),
    margin: 0,
  };

  return (
    <blockquote
      className="pf-block pf-testimonial"
      style={quoteStyle}
      data-pf-block-type="testimonial"
      data-pf-block-id={blockId}
    >
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      <p
        className="pf-testimonial-quote"
        style={{ fontSize: cssVar("fontSize", "lg"), lineHeight: cssVar("lineHeight", "lg"), margin: 0 }}
      >
        {quote}
      </p>
      <footer
        className="pf-testimonial-attribution"
        style={{ marginTop: cssVar("spacing", "sm") }}
      >
        <cite className="pf-testimonial-author" style={{ fontStyle: "normal", fontWeight: "700" }}>
          {author}
        </cite>
        {role ? (
          <span className="pf-testimonial-role" style={{ color: cssVar("color", "muted-foreground") }}>
            {", "}
            {role}
          </span>
        ) : null}
      </footer>
    </blockquote>
  );
}
