import { describe, expect, it } from "vitest";
import type { ScannedFile } from "../src/scan.js";
import { checkAstroContainment, checkPuckContainment } from "../src/containment.js";

function file(path: string, text: string, imports: string[]): ScannedFile {
  return { path, text, imports };
}

describe("checkAstroContainment (ADR-0007)", () => {
  it("fails the build when a block package imports Astro", () => {
    const violations = checkAstroContainment([
      file("packages/blocks/src/Hero.tsx", `import { Something } from "astro";`, ["astro"]),
    ]);
    expect(violations).toEqual([
      { rule: "no-astro-outside-publish-pipeline", file: "packages/blocks/src/Hero.tsx", specifier: "astro" },
    ]);
  });

  it("catches an @astrojs/* subpath import too", () => {
    const violations = checkAstroContainment([
      file("apps/api/src/app.ts", `import react from "@astrojs/react";`, ["@astrojs/react"]),
    ]);
    expect(violations).toHaveLength(1);
  });

  it("allows an Astro import inside packages/publish", () => {
    const violations = checkAstroContainment([
      file("packages/publish/src/build.ts", `import { build } from "astro";`, ["astro"]),
    ]);
    expect(violations).toEqual([]);
  });

  it("does not flag a package whose path merely starts with the same prefix (packages/publish-extra)", () => {
    const violations = checkAstroContainment([
      file("packages/publish-extra/src/x.ts", `import "astro";`, ["astro"]),
    ]);
    expect(violations).toHaveLength(1);
  });
});

describe("checkPuckContainment (ADR-0004)", () => {
  it("fails the build when a block component imports Puck context", () => {
    const violations = checkPuckContainment([
      file("packages/blocks/src/hero/Hero.tsx", `import type { PuckContext } from "@puckeditor/core";`, ["@puckeditor/core"]),
    ]);
    expect(violations).toEqual([
      { rule: "no-puck-context-in-blocks", file: "packages/blocks/src/hero/Hero.tsx", specifier: "@puckeditor/core" },
    ]);
  });

  it("allows @puckeditor/core inside packages/puck-adapter", () => {
    const violations = checkPuckContainment([
      file("packages/puck-adapter/src/config.tsx", `import type { Config } from "@puckeditor/core";`, ["@puckeditor/core"]),
    ]);
    expect(violations).toEqual([]);
  });

  it("ignores unrelated packages entirely", () => {
    const violations = checkPuckContainment([
      file("apps/editor/src/main.tsx", `import { Puck } from "@puckeditor/core";`, ["@puckeditor/core"]),
    ]);
    expect(violations).toEqual([]);
  });
});
