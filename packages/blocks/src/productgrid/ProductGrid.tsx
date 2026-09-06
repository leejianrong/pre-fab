import type { CSSProperties } from "react";
import type { ProductDocument } from "@prefab/schema";
import { cssVar } from "../theme-css.js";
import { IntrinsicGridFallback, ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { ProductGridProps } from "./schema.js";

export type ProductGridEntry = Pick<
  ProductDocument,
  "id" | "slug" | "title" | "price" | "currency" | "images" | "fulfillmentType" | "stockCount"
>;

/**
 * Injected by the publish pipeline's route expansion (@prefab/publish's
 * page-template.ts), the identical build-time-injection pattern
 * PostListRenderProps already documents — never part of this block's own
 * stored props. Inside the Puck canvas, none of these are supplied (there
 * is no products data source in the editor canvas), so the block renders
 * its empty state there.
 */
export interface ProductGridRenderProps {
  products?: ProductGridEntry[];
  pageNumber?: number;
  totalPages?: number;
  basePath?: string;
}

const MOBILE_MIN_CARD_PX = 160;

/** `price` is always cents — same division-point-for-display-only rule as Payment.tsx's formatAmount. */
function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(price / 100);
  } catch {
    return `${(price / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function isOutOfStock(product: ProductGridEntry): boolean {
  return product.fulfillmentType === "physical" && (product.stockCount ?? 0) <= 0;
}

/**
 * The root element doubles as the CSS grid itself (same convention
 * CardGrid/Gallery already use) — this is what lets the responsive
 * `columns` override (`columnsProperty="grid-template-columns"` below)
 * actually repaint this block's own column count, rather than a wrapper
 * element the override has no effect on. Heading and pagination span every
 * column via `gridColumn: "1 / -1"`.
 */
export function ProductGrid(props: ProductGridProps & BlockRenderProps & ProductGridRenderProps) {
  // productsPerPage isn't read here: the caller (@prefab/publish's
  // page-template.ts) already slices `products` to the right page before
  // this renders — it only exists as a stored prop so getStaticPaths can
  // compute pagination from it (mirrors PostList's own comment).
  const { heading, columns, showPrice, blockId, responsive, products, pageNumber = 1, totalPages = 1, basePath = "" } = props;

  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`,
    gap: cssVar("spacing", "element"),
    padding: `${cssVar("spacing", "section")} ${cssVar("spacing", "element")}`,
  };
  const fullRowStyle: CSSProperties = { gridColumn: "1 / -1" };
  const headingStyle: CSSProperties = {
    ...fullRowStyle,
    fontSize: cssVar("fontSize", "heading"),
    lineHeight: cssVar("lineHeight", "heading"),
    margin: 0,
  };
  const cardStyle: CSSProperties = {
    background: cssVar("color", "surface"),
    color: cssVar("color", "surface-foreground"),
    borderRadius: cssVar("radius", "card"),
    padding: cssVar("spacing", "element"),
  };
  const imageStyle: CSSProperties = {
    width: "100%",
    aspectRatio: "1 / 1",
    objectFit: "cover",
    borderRadius: cssVar("radius", "control"),
    marginBottom: cssVar("spacing", "sm"),
  };
  const titleStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "lg"),
    lineHeight: cssVar("lineHeight", "lg"),
    color: cssVar("color", "surface-foreground"),
    margin: 0,
    textDecoration: "none",
    display: "block",
  };
  const priceStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "body"),
    lineHeight: cssVar("lineHeight", "body"),
    color: cssVar("color", "surface-foreground"),
    margin: `${cssVar("spacing", "xs")} 0 0`,
  };
  const outOfStockStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "sm"),
    lineHeight: cssVar("lineHeight", "sm"),
    color: cssVar("color", "foreground"),
    opacity: 0.7,
    margin: `${cssVar("spacing", "xs")} 0 0`,
  };
  const excerptStyle: CSSProperties = {
    ...fullRowStyle,
    fontSize: cssVar("fontSize", "body"),
    lineHeight: cssVar("lineHeight", "body"),
    color: cssVar("color", "foreground"),
  };
  const paginationStyle: CSSProperties = {
    ...fullRowStyle,
    display: "flex",
    justifyContent: "space-between",
  };
  const paginationLinkStyle: CSSProperties = { color: cssVar("color", "accent") };

  const prevHref = pageNumber > 1 ? (pageNumber - 1 === 1 ? `/${basePath}` : `/${basePath}/page/${pageNumber - 1}`) : null;
  const nextHref = pageNumber < totalPages ? `/${basePath}/page/${pageNumber + 1}` : null;

  return (
    <div className="pf-block pf-productgrid" style={gridStyle} data-pf-block-type="productgrid" data-pf-block-id={blockId}>
      <ResponsiveStyle
        blockId={blockId ?? ""}
        responsive={responsive ?? {}}
        naturalDisplay="grid"
        columnsProperty="grid-template-columns"
      />
      <IntrinsicGridFallback className="pf-productgrid" minTrackPx={MOBILE_MIN_CARD_PX} />
      {heading ? (
        <h2 className="pf-productgrid-heading" style={headingStyle}>
          {heading}
        </h2>
      ) : null}
      {!products || products.length === 0 ? (
        <p className="pf-productgrid-empty" style={excerptStyle}>
          No products yet.
        </p>
      ) : (
        <>
          {products.map((product) => (
            <div key={product.id} className="pf-productgrid-item" style={cardStyle}>
              {product.images[0] ? (
                <img className="pf-productgrid-item-image" src={product.images[0]} alt="" style={imageStyle} />
              ) : null}
              <a className="pf-productgrid-item-title" href={`/${basePath}/${product.slug}`} style={titleStyle}>
                {product.title}
              </a>
              {showPrice ? (
                <p className="pf-productgrid-item-price" style={priceStyle}>
                  {formatPrice(product.price, product.currency)}
                </p>
              ) : null}
              {isOutOfStock(product) ? (
                <p className="pf-productgrid-item-outofstock" style={outOfStockStyle}>
                  Out of stock
                </p>
              ) : null}
            </div>
          ))}
          {totalPages > 1 ? (
            <nav className="pf-productgrid-pagination" style={paginationStyle} aria-label="Pagination">
              {prevHref ? (
                <a href={prevHref} style={paginationLinkStyle}>
                  ← Newer
                </a>
              ) : (
                <span />
              )}
              {nextHref ? (
                <a href={nextHref} style={paginationLinkStyle}>
                  Older →
                </a>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
