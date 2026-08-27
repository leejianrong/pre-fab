import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Image, imageBlockDefinition, imageDefaultProps, ImagePropsSchema } from "../src/image/index.js";

describe("Image block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(Image, imageDefaultProps));
    expect(html).toContain(`src="${imageDefaultProps.src}"`);
    expect(html).toContain('data-pf-block-type="image"');
  });

  it("renders the caption only when non-empty", () => {
    const withCaption = renderToStaticMarkup(
      createElement(Image, { ...imageDefaultProps, caption: "A photo" }),
    );
    expect(withCaption).toContain("pf-image-caption");
    expect(withCaption).toContain("A photo");

    const withoutCaption = renderToStaticMarkup(createElement(Image, imageDefaultProps));
    expect(withoutCaption).not.toContain("pf-image-caption");
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(Image, { ...imageDefaultProps, caption: "Caption" }));
    expect(html).toMatch(/var\(--pf-radius-card\)/);
    expect(html).toMatch(/var\(--pf-fontSize-sm\)/);
    expect(html).toMatch(/var\(--pf-color-muted-foreground\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('applies no border-radius style at all when radius is "none"', () => {
    const html = renderToStaticMarkup(createElement(Image, { ...imageDefaultProps, radius: "none" }));
    expect(html).not.toMatch(/border-radius/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = ImagePropsSchema.safeParse({ ...imageDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(imageBlockDefinition.version).toBe(1);
    expect(Object.keys(imageBlockDefinition.migrations)).toHaveLength(0);
  });
});
