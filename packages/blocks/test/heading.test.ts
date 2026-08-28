import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Heading, headingBlockDefinition, headingDefaultProps, HeadingPropsSchema } from "../src/index.js";

describe("Heading block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(Heading, headingDefaultProps));
    expect(html).toContain(headingDefaultProps.text);
    expect(html).toContain('data-pf-block-type="heading"');
  });

  it("renders the chosen heading level as the actual tag", () => {
    const html = renderToStaticMarkup(createElement(Heading, { ...headingDefaultProps, level: "h1" }));
    expect(html).toContain("<h1");
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(Heading, headingDefaultProps));
    expect(html).toMatch(/var\(--pf-fontSize-heading\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = HeadingPropsSchema.safeParse({ ...headingDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(headingBlockDefinition.version).toBe(1);
    expect(Object.keys(headingBlockDefinition.migrations)).toHaveLength(0);
  });
});
