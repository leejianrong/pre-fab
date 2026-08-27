import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Footer, footerBlockDefinition, footerDefaultProps, FooterPropsSchema } from "../src/footer/index.js";

describe("Footer block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(Footer, footerDefaultProps));
    expect(html).toContain(footerDefaultProps.text);
    expect(html).toContain('data-pf-block-type="footer"');
  });

  it("renders links when present", () => {
    const html = renderToStaticMarkup(
      createElement(Footer, {
        ...footerDefaultProps,
        links: [{ label: "Privacy", href: "/privacy" }],
      }),
    );
    expect(html).toContain("Privacy");
    expect(html).toContain('href="/privacy"');
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(Footer, footerDefaultProps));
    expect(html).toMatch(/var\(--pf-color-surface\)/);
    expect(html).toMatch(/var\(--pf-color-border\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = FooterPropsSchema.safeParse({ ...footerDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("props schema rejects more than 6 links", () => {
    const links = Array.from({ length: 7 }, (_, i) => ({ label: `Link ${i}`, href: `/${i}` }));
    const result = FooterPropsSchema.safeParse({ ...footerDefaultProps, links });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(footerBlockDefinition.version).toBe(1);
    expect(Object.keys(footerBlockDefinition.migrations)).toHaveLength(0);
  });
});
