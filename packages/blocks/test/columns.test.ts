import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Columns, columnsBlockDefinition, columnsDefaultProps, ColumnsPropsSchema } from "../src/columns/index.js";

describe("Columns block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(Columns, columnsDefaultProps));
    expect(html).toContain('data-pf-block-type="columns"');
    expect(html).toContain("data-pf-columns-block");
  });

  it("renders exactly `count` empty placeholder column cells", () => {
    const html = renderToStaticMarkup(createElement(Columns, { ...columnsDefaultProps, count: 4 }));
    const matches = html.match(/class="pf-column"/g) ?? [];
    expect(matches).toHaveLength(4);
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(Columns, columnsDefaultProps));
    expect(html).toMatch(/var\(--pf-spacing-element\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = ColumnsPropsSchema.safeParse({ ...columnsDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("props schema rejects a count outside 2-4", () => {
    expect(ColumnsPropsSchema.safeParse({ ...columnsDefaultProps, count: 1 }).success).toBe(false);
    expect(ColumnsPropsSchema.safeParse({ ...columnsDefaultProps, count: 5 }).success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(columnsBlockDefinition.version).toBe(1);
    expect(Object.keys(columnsBlockDefinition.migrations)).toHaveLength(0);
  });
});
