import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Form, formBlockDefinition, formDefaultProps, FormPropsSchema } from "../src/form/index.js";

describe("Form block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004), the first interactive block", () => {
    const html = renderToStaticMarkup(createElement(Form, { ...formDefaultProps, blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }));
    expect(html).toContain('data-pf-block-type="form"');
    expect(html).toContain(formDefaultProps.heading);
    expect(html).toContain("<form");
  });

  it("renders one labelled control per field, in field order", () => {
    const html = renderToStaticMarkup(
      createElement(Form, {
        ...formDefaultProps,
        fields: [
          { type: "text", label: "Name", name: "name", required: true, options: "" },
          { type: "select", label: "Topic", name: "topic", required: false, options: "Sales\nSupport" },
          { type: "checkbox", label: "Subscribe", name: "subscribe", required: false, options: "" },
        ],
        blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      }),
    );
    expect(html).toContain('name="name"');
    expect(html).toContain("<select");
    expect(html).toContain(">Sales<");
    expect(html).toContain('type="checkbox"');
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(Form, { ...formDefaultProps, blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }));
    expect(html).toMatch(/var\(--pf-color-accent\)/);
    expect(html).toMatch(/var\(--pf-radius-control\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = FormPropsSchema.safeParse({ ...formDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("rejects a field name that isn't a valid identifier", () => {
    const result = FormPropsSchema.safeParse({
      ...formDefaultProps,
      fields: [{ type: "text", label: "Bad", name: "not a name!", required: false, options: "" }],
    });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(formBlockDefinition.version).toBe(1);
    expect(Object.keys(formBlockDefinition.migrations)).toHaveLength(0);
  });

  it("does not render the Turnstile widget when turnstileEnabled is false, even with a site key supplied", () => {
    const html = renderToStaticMarkup(
      createElement(Form, { ...formDefaultProps, blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", turnstileSiteKey: "site-key" }),
    );
    expect(html).not.toContain("cf-turnstile");
  });

  it("renders the Turnstile widget when enabled and a site key is supplied", () => {
    const html = renderToStaticMarkup(
      createElement(Form, { ...formDefaultProps, turnstileEnabled: true, blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", turnstileSiteKey: "site-key" }),
    );
    expect(html).toContain("cf-turnstile");
    expect(html).toContain("site-key");
  });
});
