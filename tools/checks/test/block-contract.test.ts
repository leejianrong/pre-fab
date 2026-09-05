import { describe, expect, it } from "vitest";
import type { ScannedFile } from "../src/scan.js";
import { checkNoRawColorsInBlocks } from "../src/block-contract.js";

function file(path: string, text: string): ScannedFile {
  return { path, text, imports: [] };
}

describe("checkNoRawColorsInBlocks (CLAUDE.md invariant 2 / ADR-0002)", () => {
  it("fails on a 6-digit hex color", () => {
    const violations = checkNoRawColorsInBlocks([
      file("packages/blocks/src/hero/Hero.tsx", `const style = { background: "#4f46e5" };`),
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: "packages/blocks/src/hero/Hero.tsx", value: "#4f46e5" });
  });

  it("fails on a 3-digit hex color inside a larger string", () => {
    const violations = checkNoRawColorsInBlocks([
      file("packages/blocks/src/hero/Hero.tsx", `const style = { border: "1px solid #fff" };`),
    ]);
    expect(violations).toHaveLength(1);
  });

  it("fails on rgba()", () => {
    const violations = checkNoRawColorsInBlocks([
      file("packages/blocks/src/hero/Hero.tsx", `const scrim = "rgba(0,0,0,0.5)";`),
    ]);
    expect(violations).toHaveLength(1);
  });

  it("fails inside a template literal", () => {
    const violations = checkNoRawColorsInBlocks([
      file("packages/blocks/src/hero/Hero.tsx", "const style = `1px solid ${x}#4f46e5`;"),
    ]);
    expect(violations).toHaveLength(1);
  });

  it("passes a cssVar() call composed into a larger string (Hero's image scrim)", () => {
    const violations = checkNoRawColorsInBlocks([
      file(
        "packages/blocks/src/hero/Hero.tsx",
        `const overlay = { background: cssVar("color", "accent") };`,
      ),
    ]);
    expect(violations).toEqual([]);
  });

  it("passes a structural literal that isn't a color — border width, em padding, opacity", () => {
    const violations = checkNoRawColorsInBlocks([
      file(
        "packages/blocks/src/button/Button.tsx",
        `const style = { border: "1px solid transparent", padding: "0.75em 1.5em", opacity: 0.55 };`,
      ),
    ]);
    expect(violations).toEqual([]);
  });

  it("ignores files outside packages/blocks", () => {
    const violations = checkNoRawColorsInBlocks([file("apps/editor/src/ui/tokens.css.ts", `const c = "#4f46e5";`)]);
    expect(violations).toEqual([]);
  });

  it("ignores test files", () => {
    const violations = checkNoRawColorsInBlocks([file("packages/blocks/test/hero.test.ts", `const c = "#4f46e5";`)]);
    expect(violations).toEqual([]);
  });

  it("ignores non-.tsx files (a block's schema.ts has no styling to check)", () => {
    const violations = checkNoRawColorsInBlocks([file("packages/blocks/src/hero/schema.ts", `const c = "#4f46e5";`)]);
    expect(violations).toEqual([]);
  });
});
