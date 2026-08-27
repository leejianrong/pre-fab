import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  Testimonial,
  testimonialBlockDefinition,
  testimonialDefaultProps,
  TestimonialPropsSchema,
} from "../src/testimonial/index.js";

describe("Testimonial block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(Testimonial, testimonialDefaultProps));
    expect(html).toContain("This is the best product we");
    expect(html).toContain(testimonialDefaultProps.author);
    expect(html).toContain('data-pf-block-type="testimonial"');
  });

  it("omits the role byline when role is empty", () => {
    const html = renderToStaticMarkup(
      createElement(Testimonial, { ...testimonialDefaultProps, role: "" }),
    );
    expect(html).not.toContain("pf-testimonial-role");
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(Testimonial, testimonialDefaultProps));
    expect(html).toMatch(/var\(--pf-color-surface\)/);
    expect(html).toMatch(/var\(--pf-fontSize-lg\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = TestimonialPropsSchema.safeParse({ ...testimonialDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(testimonialBlockDefinition.version).toBe(1);
    expect(Object.keys(testimonialBlockDefinition.migrations)).toHaveLength(0);
  });
});
