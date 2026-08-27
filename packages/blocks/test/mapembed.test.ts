import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  MapEmbed,
  mapembedBlockDefinition,
  mapembedDefaultProps,
  MapEmbedPropsSchema,
} from "../src/mapembed/index.js";

describe("MapEmbed block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(MapEmbed, mapembedDefaultProps));
    expect(html).toContain('data-pf-block-type="mapembed"');
    expect(html).toContain("<iframe");
    expect(html).toContain('title="Map"');
    expect(html).toContain('loading="lazy"');
  });

  it("URL-encodes special characters in the query so they cannot break the query string", () => {
    const html = renderToStaticMarkup(
      createElement(MapEmbed, { ...mapembedDefaultProps, query: "Smith & Sons, 123 Main St?" }),
    );
    const match = html.match(/src="([^"]*)"/);
    expect(match).not.toBeNull();
    const src = match![1];
    // The encoded query must appear as a single opaque token — no raw "&" or
    // "?" from the input leaking into the URL outside the encoded segment.
    expect(src).toContain(encodeURIComponent("Smith & Sons, 123 Main St?"));
    expect(src).not.toContain("Smith & Sons");
    // Exactly one "&" (separating q= from output=) and one "?" (query start).
    expect((src.match(/&/g) ?? []).length).toBe(1);
    expect((src.match(/\?/g) ?? []).length).toBe(1);
  });

  it("renders no <iframe> at all when query is empty", () => {
    const html = renderToStaticMarkup(createElement(MapEmbed, { ...mapembedDefaultProps, query: "" }));
    expect(html).not.toContain("<iframe");
    expect(html).toContain("pf-mapembed-placeholder");
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(MapEmbed, { ...mapembedDefaultProps, query: "" }));
    expect(html).toMatch(/var\(--pf-color-muted\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = MapEmbedPropsSchema.safeParse({ ...mapembedDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(mapembedBlockDefinition.version).toBe(1);
    expect(Object.keys(mapembedBlockDefinition.migrations)).toHaveLength(0);
  });
});
