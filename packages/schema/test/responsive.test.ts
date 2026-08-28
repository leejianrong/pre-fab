import { describe, expect, it } from "vitest";
import { resolveResponsiveOverride } from "../src/responsive.js";

describe("resolveResponsiveOverride", () => {
  it("base has no overrides, regardless of what md/lg define", () => {
    expect(resolveResponsiveOverride({ md: { hidden: true }, lg: { columns: 4 } }, "base")).toEqual({});
  });

  it("md applies only its own overrides", () => {
    expect(resolveResponsiveOverride({ md: { columns: 2 } }, "md")).toEqual({ columns: 2 });
  });

  it("lg cascades from md when lg doesn't redefine a field", () => {
    expect(resolveResponsiveOverride({ md: { columns: 2, hidden: true } }, "lg")).toEqual({
      columns: 2,
      hidden: true,
    });
  });

  it("lg wins over md field-by-field when both define the same field", () => {
    expect(resolveResponsiveOverride({ md: { columns: 2 }, lg: { columns: 4 } }, "lg")).toEqual({ columns: 4 });
  });

  it("lg keeps md's untouched fields while overriding the one it redefines", () => {
    expect(resolveResponsiveOverride({ md: { columns: 2, hidden: false }, lg: { columns: 4 } }, "lg")).toEqual({
      columns: 4,
      hidden: false,
    });
  });

  it("returns an empty object when nothing is set for the breakpoint", () => {
    expect(resolveResponsiveOverride({}, "md")).toEqual({});
    expect(resolveResponsiveOverride({}, "lg")).toEqual({});
  });
});
