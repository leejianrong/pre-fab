import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { EmbedProps } from "./schema.js";

// Layout dimensions for the embed frame, not a color/spacing/type value —
// same structural-literal precedent as Hero's "0.75em 1.5em" CTA padding
// and Button's fixed border widths; not theme-token-eligible.
const HEIGHT_PX: Record<EmbedProps["height"], number> = {
  sm: 240,
  md: 400,
  lg: 640,
};

/**
 * ADR-0011 / SLICES.md [ASSUMED]: tenant-authored HTML/JS must never run
 * on the site's own origin. The mechanism is the `sandbox` attribute
 * without `allow-same-origin`: a sandboxed `srcDoc` iframe with no
 * `allow-same-origin` is placed by the browser on a unique, opaque origin
 * distinct from the parent page — scripts inside it can still run
 * (`allow-scripts`, needed for real embed widgets to function at all) but
 * cannot read the parent page's DOM, cookies, or localStorage, and cannot
 * make same-origin requests to the site's own origin. Adding
 * `allow-same-origin` back would silently defeat this — never add it here.
 *
 * `html` reaches the DOM only via React's `srcDoc` prop, which React
 * serialises as a normal (escaped) HTML attribute value when this
 * server-renders to static markup — the same escaping every other string
 * prop in this codebase gets, so there is no attribute-breakout surface
 * either.
 */
export function Embed(props: EmbedProps & BlockRenderProps) {
  const { html, height, blockId, responsive } = props;

  const wrapperStyle: CSSProperties = {
    padding: `${cssVar("spacing", "sm")} 0`,
  };

  if (html.trim().length === 0) {
    return (
      <div
        className="pf-block pf-embed pf-embed-empty"
        style={{
          ...wrapperStyle,
          background: cssVar("color", "surface"),
          color: cssVar("color", "muted-foreground"),
          borderRadius: cssVar("radius", "card"),
          padding: cssVar("spacing", "element"),
        }}
        data-pf-block-type="embed"
        data-pf-block-id={blockId}
      >
        <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
        No embed content set.
      </div>
    );
  }

  return (
    <div className="pf-block pf-embed" style={wrapperStyle} data-pf-block-type="embed" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      <iframe
        className="pf-embed-frame"
        srcDoc={html}
        sandbox="allow-scripts allow-popups"
        referrerPolicy="no-referrer"
        loading="lazy"
        title="Embedded content"
        style={{ width: "100%", height: `${HEIGHT_PX[height]}px`, border: "none" }}
      />
    </div>
  );
}
