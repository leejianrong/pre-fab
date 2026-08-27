import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { FooterProps } from "./schema.js";

export function Footer(props: FooterProps & BlockRenderProps) {
  const { text, links, blockId, responsive } = props;

  const footerStyle: CSSProperties = {
    background: cssVar("color", "surface"),
    color: cssVar("color", "surface-foreground"),
    borderTop: `1px solid ${cssVar("color", "border")}`,
    padding: `${cssVar("spacing", "lg")} ${cssVar("spacing", "element")}`,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: cssVar("spacing", "sm"),
  };

  const listStyle: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: cssVar("spacing", "sm"),
    margin: 0,
    padding: 0,
    listStyle: "none",
  };

  const linkStyle: CSSProperties = {
    color: cssVar("color", "surface-foreground"),
    fontSize: cssVar("fontSize", "sm"),
    textDecoration: "none",
  };

  return (
    <footer className="pf-block pf-footer" style={footerStyle} data-pf-block-type="footer" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      <p className="pf-footer-text" style={{ margin: 0, fontSize: cssVar("fontSize", "sm") }}>
        {text}
      </p>
      {links.length > 0 ? (
        <nav className="pf-footer-links" aria-label="Footer">
          <ul style={listStyle}>
            {links.map((link, index) => (
              <li key={index}>
                <a href={link.href} style={linkStyle}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </footer>
  );
}
