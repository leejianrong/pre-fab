import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Embed, embedBlockDefinition, embedDefaultProps, EmbedPropsSchema } from "../src/index.js";

describe("Embed block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(Embed, { ...embedDefaultProps, html: "<p>hi</p>" }));
    expect(html).toContain('data-pf-block-type="embed"');
  });

  it("renders a placeholder, not an iframe, when html is empty", () => {
    const html = renderToStaticMarkup(createElement(Embed, embedDefaultProps));
    expect(html).not.toContain("<iframe");
    expect(html).toContain("No embed content set");
  });

  it("renders a sandboxed iframe with no allow-same-origin when html is set", () => {
    const html = renderToStaticMarkup(createElement(Embed, { ...embedDefaultProps, html: "<script>alert(1)</script>" }));
    expect(html).toContain("<iframe");
    const sandboxMatch = html.match(/sandbox="([^"]*)"/);
    expect(sandboxMatch).not.toBeNull();
    expect(sandboxMatch![1]).toContain("allow-scripts");
    expect(sandboxMatch![1]).not.toContain("allow-same-origin");
  });

  it("safely HTML-attribute-escapes embed content into srcdoc — no attribute breakout", () => {
    const malicious = '"><script>window.parentPwned=true</script>';
    const html = renderToStaticMarkup(createElement(Embed, { ...embedDefaultProps, html: malicious }));
    // The literal payload must never appear unescaped as raw markup outside the srcdoc attribute value.
    expect(html).not.toContain('"><script>window.parentPwned=true</script>');
  });

  it("references theme tokens only for the empty-state placeholder, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(Embed, embedDefaultProps));
    expect(html).toMatch(/var\(--pf-color-surface\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = EmbedPropsSchema.safeParse({ ...embedDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(embedBlockDefinition.version).toBe(1);
    expect(Object.keys(embedBlockDefinition.migrations)).toHaveLength(0);
  });
});
