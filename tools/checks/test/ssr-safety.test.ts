import { describe, expect, it } from "vitest";
import type { ScannedFile } from "../src/scan.js";
import { checkSsrSafety } from "../src/ssr-safety.js";

function blockFile(text: string): ScannedFile {
  return { path: "packages/blocks/src/hero/Hero.tsx", text, imports: [] };
}

describe("checkSsrSafety (ADR-0004 — no browser-only API outside an effect)", () => {
  it("flags window accessed at module scope", () => {
    const violations = checkSsrSafety(
      [blockFile(`const width = window.innerWidth;\nexport function Hero() { return null; }`)],
      ["packages/blocks"],
    );
    expect(violations).toEqual([{ file: "packages/blocks/src/hero/Hero.tsx", line: 1, identifier: "window" }]);
  });

  it("flags document referenced directly in a component body", () => {
    const violations = checkSsrSafety(
      [blockFile(`export function Hero() {\n  const el = document.getElementById("x");\n  return null;\n}`)],
      ["packages/blocks"],
    );
    expect(violations).toEqual([{ file: "packages/blocks/src/hero/Hero.tsx", line: 2, identifier: "document" }]);
  });

  it("allows the same reference inside a useEffect callback", () => {
    const violations = checkSsrSafety(
      [
        blockFile(
          `import { useEffect } from "react";\nexport function Hero() {\n  useEffect(() => {\n    window.addEventListener("resize", () => {});\n  }, []);\n  return null;\n}`,
        ),
      ],
      ["packages/blocks"],
    );
    expect(violations).toEqual([]);
  });

  it("allows the same reference inside useLayoutEffect too", () => {
    const violations = checkSsrSafety(
      [blockFile(`useLayoutEffect(() => { localStorage.getItem("x"); }, []);`)],
      ["packages/blocks"],
    );
    expect(violations).toEqual([]);
  });

  it("does not flag `window` used only as a property name (foo.window)", () => {
    const violations = checkSsrSafety([blockFile(`const x = someObject.window;`)], ["packages/blocks"]);
    expect(violations).toEqual([]);
  });

  it("ignores files outside the target packages", () => {
    const violations = checkSsrSafety(
      [{ path: "apps/editor/src/main.tsx", text: `window.location.reload();`, imports: [] }],
      ["packages/blocks"],
    );
    expect(violations).toEqual([]);
  });
});
