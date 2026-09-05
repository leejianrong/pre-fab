import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { IntrinsicGridFallback, ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { CardGridProps } from "./schema.js";

// KAN-1204 (docs/design-audit-2026-09.md §5): the card-width floor the
// built-in mobile fallback (see IntrinsicGridFallback) collapses columns
// against below 640px — wide enough that even a long, single unbreakable
// word (the actual root cause: "Mathematics" at fontSize.lg against a ~77px
// card) has real room, with overflowWrap/wordBreak below as the backstop for
// whatever's still too long.
const MOBILE_MIN_CARD_PX = 160;

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
    lineHeight: cssVar("lineHeight", "lg"),
    margin: 0,
    // KAN-1204 §5: a single unbreakable word (e.g. "Mathematics") no longer
    // simply overflows the card's box — this is the fix half of the "4
    // templates overflow at 375px" root cause, paired with the mobile
    // column fallback below.
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  const bodyStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "body"),
    lineHeight: cssVar("lineHeight", "body"),
    color: cssVar("color", "surface-foreground"),
    margin: `${cssVar("spacing", "xs")} 0 0`,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
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
      <IntrinsicGridFallback className="pf-cardgrid" minTrackPx={MOBILE_MIN_CARD_PX} />
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
