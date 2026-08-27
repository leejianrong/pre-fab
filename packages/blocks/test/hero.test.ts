import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Hero, heroBlockDefinition, heroDefaultProps, HeroPropsSchema } from "../src/index.js";

describe("Hero block", () => {
  it("server-renders with react-dom/server — proof it never touches window/document (ADR-0004 SSR-safety)", () => {
    const html = renderToStaticMarkup(createElement(Hero, heroDefaultProps));
    expect(html).toContain(heroDefaultProps.heading);
    expect(html).toContain('data-pf-block-type="hero"');
  });

  it("references theme tokens via CSS custom properties, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(Hero, heroDefaultProps));
    expect(html).toMatch(/var\(--pf-color-background\)/);
    expect(html).toMatch(/var\(--pf-color-accent\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("omits the CTA when either label or href is empty", () => {
    const html = renderToStaticMarkup(
      createElement(Hero, { ...heroDefaultProps, ctaLabel: "", ctaHref: "" }),
    );
    expect(html).not.toContain("pf-hero-cta");
  });

  it("props schema rejects an unrecognised field", () => {
    const result = HeroPropsSchema.safeParse({ ...heroDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(heroBlockDefinition.version).toBe(1);
    expect(Object.keys(heroBlockDefinition.migrations)).toHaveLength(0);
  });
});
