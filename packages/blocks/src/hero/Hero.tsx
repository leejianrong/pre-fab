import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { HeroProps } from "./schema.js";

/**
 * Slice 1's one block type, since extended (Slice 2) with the two props
 * every first-party block accepts on top of its own: `blockId` and
 * `responsive` (BlockRenderProps — see responsive.tsx). Still deliberately
 * plain otherwise: no state, no effects, no browser-only API — this is
 * what "SSR-safe and free of Puck-specific context" (ADR-0004) looks like
 * in practice. The same component renders inside the Puck canvas (via
 * @prefab/puck-adapter) and inside the Astro publish output (via
 * @prefab/publish) with zero branching between them, which is the concrete
 * form of the WYSIWYG guarantee this slice tests.
 */
export function Hero(props: HeroProps & BlockRenderProps) {
  const { heading, subheading, ctaLabel, ctaHref, background, blockId, responsive } = props;
  const hasCta = ctaLabel.length > 0 && ctaHref.length > 0;

  const sectionStyle: CSSProperties = {
    background: cssVar("color", background),
    color: cssVar("color", "foreground"),
    padding: `${cssVar("spacing", "section")} ${cssVar("spacing", "element")}`,
  };

  return (
    <section
      className="pf-block pf-hero"
      style={sectionStyle}
      data-pf-block-type="hero"
      data-pf-block-id={blockId}
    >
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      <h1 className="pf-hero-heading" style={{ fontSize: cssVar("fontSize", "heading"), fontFamily: cssVar("fontFamily", "heading"), margin: 0 }}>
        {heading}
      </h1>
      {subheading ? (
        <p className="pf-hero-subheading" style={{ fontSize: cssVar("fontSize", "body") }}>
          {subheading}
        </p>
      ) : null}
      {hasCta ? (
        <a
          className="pf-hero-cta"
          href={ctaHref}
          style={{
            display: "inline-block",
            background: cssVar("color", "accent"),
            color: cssVar("color", "accent-foreground"),
            borderRadius: cssVar("radius", "control"),
            padding: "0.75em 1.5em",
            textDecoration: "none",
          }}
        >
          {ctaLabel}
        </a>
      ) : null}
    </section>
  );
}
