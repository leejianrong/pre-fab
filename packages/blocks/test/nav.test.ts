import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Nav, navBlockDefinition, navDefaultProps, NavPropsSchema } from "../src/nav/index.js";

describe("Nav block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(Nav, navDefaultProps));
    expect(html).toContain(navDefaultProps.brand);
    expect(html).toContain('data-pf-block-type="nav"');
  });

  it("renders links when present", () => {
    const html = renderToStaticMarkup(
      createElement(Nav, {
        ...navDefaultProps,
        links: [{ label: "About", href: "/about" }],
      }),
    );
    expect(html).toContain("About");
    expect(html).toContain('href="/about"');
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(Nav, navDefaultProps));
    expect(html).toMatch(/var\(--pf-color-background\)/);
    expect(html).toMatch(/var\(--pf-color-border\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = NavPropsSchema.safeParse({ ...navDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("props schema rejects more than 8 links", () => {
    const links = Array.from({ length: 9 }, (_, i) => ({ label: `Link ${i}`, href: `/${i}` }));
    const result = NavPropsSchema.safeParse({ ...navDefaultProps, links });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(navBlockDefinition.version).toBe(1);
    expect(Object.keys(navBlockDefinition.migrations)).toHaveLength(0);
  });
});
