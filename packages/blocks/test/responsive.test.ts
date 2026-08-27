import { describe, expect, it } from "vitest";
import { newUlid } from "@prefab/schema";
import { responsiveStyleCss } from "../src/responsive.js";

describe("responsiveStyleCss", () => {
  it("emits nothing when a block has no overrides", () => {
    expect(responsiveStyleCss(newUlid(), {})).toBe("");
  });

  it("emits nothing for a non-ULID id, regardless of overrides", () => {
    expect(responsiveStyleCss("not-a-ulid", { md: { hidden: true } })).toBe("");
  });

  it("emits an !important media rule scoped to the block's data attribute", () => {
    const id = newUlid();
    const css = responsiveStyleCss(id, { md: { hidden: true } });
    expect(css).toContain(`[data-pf-block-id="${id}"]`);
    expect(css).toContain("@media (min-width:640px)");
    expect(css).toContain("display:none !important");
  });

  it("restores the block's natural display when un-hidden at a larger breakpoint", () => {
    const id = newUlid();
    const css = responsiveStyleCss(id, { md: { hidden: true }, lg: { hidden: false } }, { naturalDisplay: "grid" });
    expect(css).toContain("@media (min-width:640px)");
    expect(css).toContain("display:none !important");
    expect(css).toContain("@media (min-width:1024px)");
    expect(css).toContain("display:grid !important");
  });

  it("emits a columns declaration only when columnsProperty is supplied", () => {
    const id = newUlid();
    const withProperty = responsiveStyleCss(id, { lg: { columns: 4 } }, { columnsProperty: "grid-template-columns" });
    expect(withProperty).toContain("grid-template-columns:repeat(4, minmax(0, 1fr)) !important");

    const withoutProperty = responsiveStyleCss(id, { lg: { columns: 4 } });
    expect(withoutProperty).toBe("");
  });

  it("emits a spacing override as a padding declaration", () => {
    const id = newUlid();
    const css = responsiveStyleCss(id, { md: { spacing: "sm" } });
    expect(css).toContain("padding:var(--pf-spacing-sm) !important");
  });
});
