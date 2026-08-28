import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { ButtonProps } from "./schema.js";

const VARIANT_STYLE: Record<ButtonProps["variant"], CSSProperties> = {
  primary: {
    background: cssVar("color", "accent"),
    color: cssVar("color", "accent-foreground"),
    border: "1px solid transparent",
  },
  secondary: {
    background: cssVar("color", "surface"),
    color: cssVar("color", "surface-foreground"),
    border: `1px solid ${cssVar("color", "border")}`,
  },
  ghost: {
    background: "transparent",
    color: cssVar("color", "accent"),
    border: `1px solid ${cssVar("color", "accent")}`,
  },
};

export function Button(props: ButtonProps & BlockRenderProps) {
  const { label, href, variant, align, blockId, responsive } = props;

  const wrapperStyle: CSSProperties = {
    display: "flex",
    justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
    padding: `${cssVar("spacing", "sm")} 0`,
  };

  const linkStyle: CSSProperties = {
    ...VARIANT_STYLE[variant],
    display: "inline-block",
    borderRadius: cssVar("radius", "control"),
    padding: "0.75em 1.5em",
    textDecoration: "none",
    fontSize: cssVar("fontSize", "body"),
  };

  return (
    <div className="pf-block pf-button" style={wrapperStyle} data-pf-block-type="button" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      <a className="pf-button-link" href={href} style={linkStyle}>
        {label}
      </a>
    </div>
  );
}
