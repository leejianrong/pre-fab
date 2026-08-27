import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { CardGridProps } from "./schema.js";

export function CardGrid(props: CardGridProps & BlockRenderProps) {
  const { cards, columns, blockId, responsive } = props;

  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`,
    gap: cssVar("spacing", "element"),
  };

  const cardStyle: CSSProperties = {
    background: cssVar("color", "surface"),
    color: cssVar("color", "surface-foreground"),
    borderRadius: cssVar("radius", "card"),
    padding: cssVar("spacing", "element"),
  };

  const titleStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "lg"),
    margin: 0,
  };

  const bodyStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "body"),
    color: cssVar("color", "surface-foreground"),
    margin: `${cssVar("spacing", "xs")} 0 0`,
  };

  const linkStyle: CSSProperties = {
    display: "inline-block",
    marginTop: cssVar("spacing", "sm"),
    color: cssVar("color", "accent"),
  };

  return (
    <div className="pf-block pf-cardgrid" style={gridStyle} data-pf-block-type="cardgrid" data-pf-block-id={blockId}>
      {/* columnsProperty lets the responsive `columns` override repaint this
          grid's column count — same mechanism as gallery/Gallery.tsx. */}
      <ResponsiveStyle
        blockId={blockId ?? ""}
        responsive={responsive ?? {}}
        naturalDisplay="grid"
        columnsProperty="grid-template-columns"
      />
      {cards.map((card, index) => (
        <div key={index} className="pf-cardgrid-card" style={cardStyle}>
          <h3 className="pf-cardgrid-title" style={titleStyle}>
            {card.title}
          </h3>
          <p className="pf-cardgrid-body" style={bodyStyle}>
            {card.body}
          </p>
          {card.href ? (
            <a className="pf-cardgrid-link" href={card.href} style={linkStyle}>
              Learn more
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}
