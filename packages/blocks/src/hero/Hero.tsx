import type { CSSProperties } from "react";
import type { HeroProps } from "./schema.js";

/**
 * Slice 1's one block type. Deliberately plain: no state, no effects, no
 * browser-only API — this is what "SSR-safe and free of Puck-specific
 * context" (ADR-0004) looks like in practice. The same component renders
 * inside the Puck canvas (via @prefab/puck-adapter) and inside the Astro
 * publish output (via @prefab/publish) with zero branching between them,
 * which is the concrete form of the WYSIWYG guarantee this slice tests.
 */
export function Hero(props: HeroProps) {
  const { heading, subheading, ctaLabel, ctaHref, background } = props;
  const hasCta = ctaLabel.length > 0 && ctaHref.length > 0;

  const sectionStyle: CSSProperties = {
    background: `var(--pf-color-${background})`,
    color: "var(--pf-color-foreground)",
    padding: "var(--pf-spacing-section) var(--pf-spacing-element)",
  };

  return (
    <section className="pf-block pf-hero" style={sectionStyle} data-pf-block-type="hero">
      <h1 className="pf-hero-heading" style={{ fontSize: "var(--pf-fontSize-heading)", margin: 0 }}>
        {heading}
      </h1>
      {subheading ? (
        <p className="pf-hero-subheading" style={{ fontSize: "var(--pf-fontSize-body)" }}>
          {subheading}
        </p>
      ) : null}
      {hasCta ? (
        <a
          className="pf-hero-cta"
          href={ctaHref}
          style={{
            display: "inline-block",
            background: "var(--pf-color-accent)",
            color: "var(--pf-color-accent-foreground)",
            borderRadius: "var(--pf-radius-control)",
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
