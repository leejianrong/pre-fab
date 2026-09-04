import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import { scrollRevealAttrs } from "../scroll-reveal.js";
import type { HeroProps } from "./schema.js";

/**
 * Slice 1's one block type, since extended (Slice 2) with the props every
 * first-party block accepts on top of its own: `blockId`, `responsive` and
 * `scrollReveal` (BlockRenderProps — see responsive.tsx). Still
 * deliberately plain otherwise: no state, no effects, no browser-only API —
 * this is what "SSR-safe and free of Puck-specific context" (ADR-0004)
 * looks like in practice. `scrollRevealAttrs` (ADR-0015) is the reference
 * example of the thin, additive change a block makes to opt into
 * scroll-reveal: one import, one destructure, one attribute spread onto the
 * root element — no wrapper, no new child, no per-block CSS. The same
 * component renders inside the Puck canvas (via @prefab/puck-adapter) and
 * inside the Astro publish output (via @prefab/publish) with zero branching
 * between them, which is the concrete form of the WYSIWYG guarantee this
 * slice tests; `scrollReveal` is simply never set inside the canvas
 * (ADR-0015), so this looks identical to before there with no extra code.
 */
export function Hero(props: HeroProps & BlockRenderProps) {
  // `backgroundImage = ""`, not a bare destructure: the publish pipeline
  // spreads a page document's stored `block.props` straight onto this
  // component with no schema-default-filling pass (packages/publish's
  // page-template.ts), so a page saved before this field existed hands it
  // `undefined` here, not "". Same reason `responsive` below is read as
  // `responsive ?? {}` rather than trusted bare.
  const { heading, subheading, ctaLabel, ctaHref, background, backgroundImage = "", blockId, responsive, scrollReveal } = props;
  const hasCta = ctaLabel.length > 0 && ctaHref.length > 0;
  const hasImage = backgroundImage.length > 0;

  // With an image, text sits over a scrim rather than the flat theme
  // background — `accent`/`accent-foreground` are reused for both rather
  // than introducing a new token pair, since every theme already picks
  // that pair to contrast (it's the CTA button's own colours).
  const sectionStyle: CSSProperties = {
    position: "relative",
    overflow: "hidden",
    background: hasImage ? cssVar("color", "accent") : cssVar("color", background),
    color: hasImage ? cssVar("color", "accent-foreground") : cssVar("color", "foreground"),
    padding: hasImage ? `calc(${cssVar("spacing", "section")} * 2) ${cssVar("spacing", "element")}` : `${cssVar("spacing", "section")} ${cssVar("spacing", "element")}`,
  };

  return (
    <section
      className="pf-block pf-hero"
      style={sectionStyle}
      data-pf-block-type="hero"
      data-pf-block-id={blockId}
      {...scrollRevealAttrs(scrollReveal)}
    >
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      {hasImage ? (
        <>
          <img
            src={backgroundImage}
            alt=""
            aria-hidden="true"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }}
          />
          <div style={{ position: "absolute", inset: 0, background: cssVar("color", "accent"), opacity: 0.55, zIndex: 0 }} />
        </>
      ) : null}
      <div style={{ position: "relative", zIndex: 1 }}>
        <h1
          className="pf-hero-heading"
          style={{ fontSize: cssVar("fontSize", "heading"), fontFamily: cssVar("fontFamily", "heading"), margin: 0, color: "inherit" }}
        >
          {heading}
        </h1>
        {subheading ? (
          <p className="pf-hero-subheading" style={{ fontSize: cssVar("fontSize", "body"), color: "inherit" }}>
            {subheading}
          </p>
        ) : null}
        {hasCta ? (
          <a
            className="pf-hero-cta"
            href={ctaHref}
            style={{
              display: "inline-block",
              background: hasImage ? cssVar("color", "background") : cssVar("color", "accent"),
              color: hasImage ? cssVar("color", "foreground") : cssVar("color", "accent-foreground"),
              borderRadius: cssVar("radius", "control"),
              padding: "0.75em 1.5em",
              textDecoration: "none",
            }}
          >
            {ctaLabel}
          </a>
        ) : null}
      </div>
    </section>
  );
}
