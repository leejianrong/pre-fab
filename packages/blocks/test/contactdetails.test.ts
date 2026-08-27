import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  ContactDetails,
  contactdetailsBlockDefinition,
  contactdetailsDefaultProps,
  ContactDetailsPropsSchema,
} from "../src/contactdetails/index.js";

describe("ContactDetails block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(ContactDetails, contactdetailsDefaultProps));
    expect(html).toContain('data-pf-block-type="contactdetails"');
    expect(html).toContain(contactdetailsDefaultProps.heading);
    expect(html).toContain(`mailto:${contactdetailsDefaultProps.email}`);
    expect(html).toContain(`tel:${contactdetailsDefaultProps.phone}`);
  });

  it("omits email, phone and address rows when they are empty", () => {
    const html = renderToStaticMarkup(
      createElement(ContactDetails, { ...contactdetailsDefaultProps, email: "", phone: "", address: "" }),
    );
    expect(html).not.toContain("pf-contactdetails-email");
    expect(html).not.toContain("pf-contactdetails-phone");
    expect(html).not.toContain("pf-contactdetails-address");
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(ContactDetails, contactdetailsDefaultProps));
    expect(html).toMatch(/var\(--pf-color-foreground\)/);
    expect(html).toMatch(/var\(--pf-color-accent\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = ContactDetailsPropsSchema.safeParse({ ...contactdetailsDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(contactdetailsBlockDefinition.version).toBe(1);
    expect(Object.keys(contactdetailsBlockDefinition.migrations)).toHaveLength(0);
  });
});
