import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Faq, faqBlockDefinition, faqDefaultProps, FaqPropsSchema } from "../src/faq/index.js";

describe("Faq block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(Faq, faqDefaultProps));
    expect(html).toContain('data-pf-block-type="faq"');
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain(faqDefaultProps.items[0].question);
    expect(html).toContain(faqDefaultProps.items[0].answer);
  });

  it("renders one <details> per item", () => {
    const html = renderToStaticMarkup(createElement(Faq, faqDefaultProps));
    const count = (html.match(/<details/g) ?? []).length;
    expect(count).toBe(faqDefaultProps.items.length);
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(Faq, faqDefaultProps));
    expect(html).toMatch(/var\(--pf-fontSize-body\)/);
    expect(html).toMatch(/var\(--pf-color-muted-foreground\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("rejects more than 12 items", () => {
    const tooMany = Array.from({ length: 13 }, (_, i) => ({
      question: `Question ${i}`,
      answer: `Answer ${i}`,
    }));
    const result = FaqPropsSchema.safeParse({ items: tooMany });
    expect(result.success).toBe(false);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = FaqPropsSchema.safeParse({ ...faqDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(faqBlockDefinition.version).toBe(1);
    expect(Object.keys(faqBlockDefinition.migrations)).toHaveLength(0);
  });
});
