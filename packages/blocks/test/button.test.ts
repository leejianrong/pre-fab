import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Button, buttonBlockDefinition, buttonDefaultProps, ButtonPropsSchema } from "../src/index.js";

describe("Button block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(Button, buttonDefaultProps));
    expect(html).toContain(buttonDefaultProps.label);
    expect(html).toContain(`href="${buttonDefaultProps.href}"`);
    expect(html).toContain('data-pf-block-type="button"');
  });

  it("references theme tokens only, never a raw value (invariant 2) — 'transparent' is a CSS keyword, not a token or a literal value", () => {
    const html = renderToStaticMarkup(createElement(Button, buttonDefaultProps));
    expect(html).toMatch(/var\(--pf-color-accent\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = ButtonPropsSchema.safeParse({ ...buttonDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(buttonBlockDefinition.version).toBe(1);
    expect(Object.keys(buttonBlockDefinition.migrations)).toHaveLength(0);
  });
});
