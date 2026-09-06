import type { CSSProperties } from "react";
import type { ProductDocument } from "@prefab/schema";
import { cssVar, PROSE_MAX_MEASURE } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import { parseMarkdownLite } from "../markdown-lite.js";
import type { ProductDetailProps } from "./schema.js";

/** Injected by the publish pipeline's per-product route (@prefab/publish's page-template.ts) — never part of stored props, same as PostDetail's `post`. Undefined inside the Puck canvas, which has no single "current product" to show. */
export interface ProductDetailRenderProps {
  product?: Pick<
    ProductDocument,
    "title" | "description" | "images" | "price" | "currency" | "fulfillmentType" | "stockCount" | "successMessage"
  >;
}

/** `price` is always cents — same division-point-for-display-only rule as Payment.tsx's formatAmount. */
function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(price / 100);
  } catch {
    return `${(price / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function ProductDetail(props: ProductDetailProps & BlockRenderProps & ProductDetailRenderProps) {
  const { product, blockId, responsive } = props;

  const articleStyle: CSSProperties = {
    padding: `${cssVar("spacing", "section")} ${cssVar("spacing", "element")}`,
    // KAN-1204-equivalent: same measure cap as RichText/PostDetail — a
    // product description is prose too, and gets the same container-width
    // constraint. See PROSE_MAX_MEASURE's doc comment.
    maxWidth: PROSE_MAX_MEASURE,
    marginLeft: "auto",
    marginRight: "auto",
  };
  const titleStyle: CSSProperties = { fontSize: cssVar("fontSize", "heading"), lineHeight: cssVar("lineHeight", "heading"), margin: 0 };
  const priceStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "lg"),
    lineHeight: cssVar("lineHeight", "lg"),
    color: cssVar("color", "foreground"),
    fontWeight: "bold",
    margin: `${cssVar("spacing", "xs")} 0 ${cssVar("spacing", "element")}`,
  };
  const imageStyle: CSSProperties = {
    width: "100%",
    borderRadius: cssVar("radius", "card"),
    margin: `0 0 ${cssVar("spacing", "sm")}`,
  };
  const imageRowStyle: CSSProperties = { display: "flex", gap: cssVar("spacing", "xs"), flexWrap: "wrap" };
  const thumbStyle: CSSProperties = {
    width: "5rem",
    height: "5rem",
    objectFit: "cover",
    borderRadius: cssVar("radius", "control"),
  };
  const bodyTextStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "body"),
    lineHeight: cssVar("lineHeight", "body"),
    margin: `0 0 ${cssVar("spacing", "sm")}`,
  };
  const outOfStockStyle: CSSProperties = {
    fontSize: cssVar("fontSize", "sm"),
    lineHeight: cssVar("lineHeight", "sm"),
    color: cssVar("color", "foreground"),
    opacity: 0.7,
    margin: `0 0 ${cssVar("spacing", "element")}`,
  };
  const buttonStyle: CSSProperties = {
    padding: `${cssVar("spacing", "xs")} ${cssVar("spacing", "element")}`,
    borderRadius: cssVar("radius", "control"),
    border: "none",
    background: cssVar("color", "accent"),
    color: cssVar("color", "accent-foreground"),
    fontSize: cssVar("fontSize", "body"),
    cursor: "not-allowed",
    opacity: 0.6,
  };

  if (!product) {
    return (
      <article className="pf-block pf-productdetail" style={articleStyle} data-pf-block-type="productdetail" data-pf-block-id={blockId}>
        <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
        <p style={bodyTextStyle}>No product selected.</p>
      </article>
    );
  }

  const outOfStock = product.fulfillmentType === "physical" && (product.stockCount ?? 0) <= 0;
  const blocks = parseMarkdownLite(product.description);

  return (
    <article className="pf-block pf-productdetail" style={articleStyle} data-pf-block-type="productdetail" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      {product.images.length > 0 ? (
        <div className="pf-productdetail-images" style={imageRowStyle}>
          <img className="pf-productdetail-cover" src={product.images[0]} alt="" style={imageStyle} />
        </div>
      ) : null}
      {product.images.length > 1 ? (
        <div className="pf-productdetail-thumbs" style={imageRowStyle}>
          {product.images.slice(1).map((src, index) => (
            <img key={index} className="pf-productdetail-thumb" src={src} alt="" style={thumbStyle} />
          ))}
        </div>
      ) : null}
      <h1 className="pf-productdetail-title" style={titleStyle}>
        {product.title}
      </h1>
      <p className="pf-productdetail-price" style={priceStyle}>
        {formatPrice(product.price, product.currency)}
      </p>
      {outOfStock ? (
        <p className="pf-productdetail-outofstock" style={outOfStockStyle} role="status">
          Out of stock
        </p>
      ) : null}
      <div className="pf-productdetail-body">
        {blocks.map((block, index) => {
          if (block.kind === "heading") {
            const Tag = (`h${block.level + 1}` as "h2" | "h3" | "h4");
            return (
              <Tag key={index} style={{ ...bodyTextStyle, fontSize: cssVar("fontSize", "lg"), lineHeight: cssVar("lineHeight", "lg") }}>
                {block.text}
              </Tag>
            );
          }
          if (block.kind === "list") {
            return (
              <ul key={index} style={{ ...bodyTextStyle, paddingLeft: "1.25em" }}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            );
          }
          return (
            <p key={index} style={bodyTextStyle}>
              {block.text}
            </p>
          );
        })}
      </div>
      {/*
        Add to cart is a visible, disabled stub — cart state and checkout
        are card 2's scope (ADR-0018), not this card's. `disabled` (rather
        than an onClick that silently does nothing) is deliberate: a
        visitor should never wonder whether a click was received.
      */}
      <button type="button" style={buttonStyle} disabled title="Cart and checkout ship in a later update">
        Add to cart
      </button>
    </article>
  );
}
