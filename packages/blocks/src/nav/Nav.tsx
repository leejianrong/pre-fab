import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { NavProps } from "./schema.js";

export function Nav(props: NavProps & BlockRenderProps) {
  const { brand, links, blockId, responsive } = props;

  const navStyle: CSSProperties = {
    background: cssVar("color", "background"),
    color: cssVar("color", "foreground"),
    borderBottom: `1px solid ${cssVar("color", "border")}`,
    padding: `${cssVar("spacing", "sm")} ${cssVar("spacing", "element")}`,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: cssVar("spacing", "sm"),
  };

  const brandStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "lg"),
    fontWeight: 700,
    color: cssVar("color", "foreground"),
  };

  const listStyle: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: cssVar("spacing", "sm"),
    margin: 0,
    padding: 0,
    listStyle: "none",
  };

  const linkStyle: CSSProperties = {
    color: cssVar("color", "foreground"),
    fontSize: cssVar("fontSize", "sm"),
    textDecoration: "none",
  };

  return (
    <nav className="pf-block pf-nav" style={navStyle} data-pf-block-type="nav" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      <span className="pf-nav-brand" style={brandStyle}>
        {brand}
      </span>
      {links.length > 0 ? (
        <ul className="pf-nav-links" style={listStyle}>
          {links.map((link, index) => (
            <li key={index}>
              <a href={link.href} style={linkStyle}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}
