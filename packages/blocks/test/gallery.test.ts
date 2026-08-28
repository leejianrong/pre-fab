import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { newUlid } from "@prefab/schema";
import { Gallery, galleryBlockDefinition, galleryDefaultProps, GalleryPropsSchema } from "../src/gallery/index.js";
import { responsiveStyleCss } from "../src/responsive.js";

describe("Gallery block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(Gallery, galleryDefaultProps));
    expect(html).toContain('data-pf-block-type="gallery"');
    expect(html).toContain(galleryDefaultProps.images[0]!.src);
  });

  it("renders one img per image and a grid-template-columns matching the base columns prop", () => {
    const html = renderToStaticMarkup(createElement(Gallery, { ...galleryDefaultProps, columns: 2 }));
    const matches = html.match(/<img/g) ?? [];
    expect(matches).toHaveLength(galleryDefaultProps.images.length);
    expect(html).toContain("grid-template-columns:repeat(2, minmax(0,1fr))");
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(Gallery, galleryDefaultProps));
    expect(html).toMatch(/var\(--pf-spacing-sm\)/);
    expect(html).toMatch(/var\(--pf-radius-card\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = GalleryPropsSchema.safeParse({ ...galleryDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("props schema rejects more than 12 images", () => {
    const tooMany = Array.from({ length: 13 }, () => ({ src: "https://placehold.co/1x1", alt: "" }));
    const result = GalleryPropsSchema.safeParse({ ...galleryDefaultProps, images: tooMany });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(galleryBlockDefinition.version).toBe(1);
    expect(Object.keys(galleryBlockDefinition.migrations)).toHaveLength(0);
  });

  it("a responsive.<bp>.columns override produces an !important grid-template-columns rule", () => {
    const id = newUlid();
    const css = responsiveStyleCss(id, { lg: { columns: 4 } }, { columnsProperty: "grid-template-columns" });
    expect(css).toContain("grid-template-columns");
    expect(css).toContain("!important");
    expect(css).toContain(`[data-pf-block-id="${id}"]`);
  });
});
