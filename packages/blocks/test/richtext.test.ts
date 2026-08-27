import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  RichText,
  richTextBlockDefinition,
  richTextDefaultProps,
  RichTextPropsSchema,
} from "../src/richtext/index.js";

describe("RichText block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(RichText, richTextDefaultProps));
    expect(html).toContain('data-pf-block-type="richtext"');
  });

  it("splits on blank lines into separate paragraphs", () => {
    const html = renderToStaticMarkup(
      createElement(RichText, { ...richTextDefaultProps, html: "First paragraph.\n\nSecond paragraph." }),
    );
    const matches = html.match(/pf-richtext-paragraph/g) ?? [];
    expect(matches).toHaveLength(2);
    expect(html).toContain("First paragraph.");
    expect(html).toContain("Second paragraph.");
  });

  it("never parses HTML from the html field — markup is escaped, not rendered", () => {
    const html = renderToStaticMarkup(
      createElement(RichText, { ...richTextDefaultProps, html: "<script>alert(1)</script>" }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(RichText, richTextDefaultProps));
    expect(html).toMatch(/var\(--pf-fontSize-body\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = RichTextPropsSchema.safeParse({ ...richTextDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(richTextBlockDefinition.version).toBe(1);
    expect(Object.keys(richTextBlockDefinition.migrations)).toHaveLength(0);
  });
});
