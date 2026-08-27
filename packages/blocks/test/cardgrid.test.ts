import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { newUlid } from "@prefab/schema";
import { CardGrid, cardGridBlockDefinition, cardGridDefaultProps, CardGridPropsSchema } from "../src/cardgrid/index.js";
import { responsiveStyleCss } from "../src/responsive.js";

describe("Card grid block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(CardGrid, cardGridDefaultProps));
    expect(html).toContain('data-pf-block-type="cardgrid"');
    expect(html).toContain(cardGridDefaultProps.cards[0]!.title);
  });

  it("renders a link only when a card's href is non-empty", () => {
    const withHref = renderToStaticMarkup(
      createElement(CardGrid, { cards: [{ title: "T", body: "B", href: "https://example.com" }], columns: 1 }),
    );
    expect(withHref).toContain("pf-cardgrid-link");

    const withoutHref = renderToStaticMarkup(
      createElement(CardGrid, { cards: [{ title: "T", body: "B", href: "" }], columns: 1 }),
    );
    expect(withoutHref).not.toContain("pf-cardgrid-link");
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(CardGrid, cardGridDefaultProps));
    expect(html).toMatch(/var\(--pf-color-surface\)/);
    expect(html).toMatch(/var\(--pf-radius-card\)/);
    expect(html).toMatch(/var\(--pf-fontSize-lg\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = CardGridPropsSchema.safeParse({ ...cardGridDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("props schema rejects more than 9 cards", () => {
    const tooMany = Array.from({ length: 10 }, () => ({ title: "T", body: "B", href: "" }));
    const result = CardGridPropsSchema.safeParse({ ...cardGridDefaultProps, cards: tooMany });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(cardGridBlockDefinition.version).toBe(1);
    expect(Object.keys(cardGridBlockDefinition.migrations)).toHaveLength(0);
  });

  it("a responsive.<bp>.columns override produces an !important grid-template-columns rule", () => {
    const id = newUlid();
    const css = responsiveStyleCss(id, { md: { columns: 2 } }, { columnsProperty: "grid-template-columns" });
    expect(css).toContain("grid-template-columns");
    expect(css).toContain("!important");
    expect(css).toContain(`[data-pf-block-id="${id}"]`);
  });
});
