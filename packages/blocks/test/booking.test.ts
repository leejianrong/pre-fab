import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Booking, bookingBlockDefinition, bookingDefaultProps, BookingPropsSchema } from "../src/booking/index.js";

describe("Booking block", () => {
  it("server-renders with react-dom/server — SSR-safe (ADR-0004), with no runtimeApiUrl (offline/Puck canvas)", () => {
    const html = renderToStaticMarkup(createElement(Booking, { ...bookingDefaultProps, blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }));
    expect(html).toContain('data-pf-block-type="booking"');
    expect(html).toContain(bookingDefaultProps.heading);
    expect(html).toContain("Booking is available once this page is published.");
  });

  it("references theme tokens only, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(createElement(Booking, { ...bookingDefaultProps, blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }));
    expect(html).toMatch(/var\(--pf-color-foreground\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("props schema rejects an unrecognised field", () => {
    const result = BookingPropsSchema.safeParse({ ...bookingDefaultProps, color: "#ff0000" });
    expect(result.success).toBe(false);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(bookingBlockDefinition.version).toBe(1);
    expect(Object.keys(bookingBlockDefinition.migrations)).toHaveLength(0);
  });

  it("renders the description when set", () => {
    const html = renderToStaticMarkup(
      createElement(Booking, { ...bookingDefaultProps, description: "Pick a 30-minute slot.", blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }),
    );
    expect(html).toContain("Pick a 30-minute slot.");
  });
});
