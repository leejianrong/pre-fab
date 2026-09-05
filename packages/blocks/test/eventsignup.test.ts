import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { EventSignup, eventSignupBlockDefinition, eventSignupDefaultProps, EventSignupPropsSchema } from "../src/eventsignup/index.js";

describe("EventSignup block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004)", () => {
    const html = renderToStaticMarkup(createElement(EventSignup, { ...eventSignupDefaultProps, blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }));
    expect(html).toContain('data-pf-block-type="eventsignup"');
    expect(html).toContain(eventSignupDefaultProps.heading);
    expect(html).toContain("<form");
  });

  it("renders one labelled control per field, in field order", () => {
    const html = renderToStaticMarkup(
      createElement(EventSignup, {
        ...eventSignupDefaultProps,
        fields: [
          { type: "text", label: "Name", name: "name", required: true, options: "" },
          { type: "select", label: "Session", name: "session", required: false, options: "Morning\nAfternoon" },
          { type: "checkbox", label: "Bring a guest", name: "guest", required: false, options: "" },
        ],
        blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      }),
    );
    expect(html).toContain('name="name"');
    expect(html).toContain("<select");
    expect(html).toContain(">Morning<");
    expect(html).toContain('type="checkbox"');
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(EventSignup, { ...eventSignupDefaultProps, blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }));
    expect(html).toMatch(/var\(--pf-color-accent\)/);
    expect(html).toMatch(/var\(--pf-radius-control\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("renders the description when set", () => {
    const html = renderToStaticMarkup(
      createElement(EventSignup, { ...eventSignupDefaultProps, description: "Sat 12 Sept, 2pm, Main Hall", blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }),
    );
    expect(html).toContain("Sat 12 Sept, 2pm, Main Hall");
  });

  it("props schema accepts a null capacity (unlimited)", () => {
    const result = EventSignupPropsSchema.safeParse({ ...eventSignupDefaultProps, capacity: null });
    expect(result.success).toBe(true);
  });

  it("props schema rejects a non-positive capacity", () => {
    const result = EventSignupPropsSchema.safeParse({ ...eventSignupDefaultProps, capacity: 0 });
    expect(result.success).toBe(false);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = EventSignupPropsSchema.safeParse({ ...eventSignupDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("rejects a field name that isn't a valid identifier", () => {
    const result = EventSignupPropsSchema.safeParse({
      ...eventSignupDefaultProps,
      fields: [{ type: "text", label: "Bad", name: "not a name!", required: false, options: "" }],
    });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(eventSignupBlockDefinition.version).toBe(1);
    expect(Object.keys(eventSignupBlockDefinition.migrations)).toHaveLength(0);
  });
});
