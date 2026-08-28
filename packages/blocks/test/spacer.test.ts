import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Spacer, spacerBlockDefinition, spacerDefaultProps, SpacerPropsSchema } from "../src/spacer/index.js";

describe("Spacer block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(Spacer, spacerDefaultProps));
    expect(html).toContain('data-pf-block-type="spacer"');
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(Spacer, spacerDefaultProps));
    expect(html).toMatch(/var\(--pf-spacing-lg\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("renders the chosen height token", () => {
    const html = renderToStaticMarkup(createElement(Spacer, { ...spacerDefaultProps, height: "xs" }));
    expect(html).toMatch(/var\(--pf-spacing-xs\)/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = SpacerPropsSchema.safeParse({ ...spacerDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(spacerBlockDefinition.version).toBe(1);
    expect(Object.keys(spacerBlockDefinition.migrations)).toHaveLength(0);
  });
});
