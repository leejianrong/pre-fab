import { describe, expect, it } from "vitest";
import type { ScannedFile } from "../src/scan.js";
import { checkAstroContainment, checkPuckContainment, checkRuntimeContainment } from "../src/containment.js";

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

describe("checkRuntimeContainment (ADR-0010)", () => {
  it("fails the build when a runtime package imports a control-plane package", () => {
    const violations = checkRuntimeContainment([
      file("packages/runtime/src/submit.ts", `import { createPool } from "@prefab/db";`, ["@prefab/db"]),
    ]);
    expect(violations).toEqual([
      { rule: "no-control-plane-in-runtime", file: "packages/runtime/src/submit.ts", specifier: "@prefab/db" },
    ]);
  });

  it("catches every listed control-plane package, not just @prefab/db", () => {
    const violations = checkRuntimeContainment([
      file("packages/runtime/src/a.ts", `import "@prefab/api-client";`, ["@prefab/api-client"]),
      file("packages/runtime/src/b.ts", `import "@prefab/commands";`, ["@prefab/commands"]),
      file("packages/runtime/src/c.ts", `import "@prefab/blocks";`, ["@prefab/blocks"]),
      file("packages/runtime/src/d.ts", `import "@prefab/publish";`, ["@prefab/publish"]),
    ]);
    expect(violations).toHaveLength(4);
  });

  it("allows @prefab/schema — pure document schema, not control-plane", () => {
    const violations = checkRuntimeContainment([
      file("packages/runtime/src/types.ts", `import type { PostDocument } from "@prefab/schema";`, ["@prefab/schema"]),
    ]);
    expect(violations).toEqual([]);
  });

  it("does not flag a package whose path merely starts with the same prefix (packages/runtime-extra)", () => {
    const violations = checkRuntimeContainment([
      file("packages/runtime-extra/src/x.ts", `import "@prefab/db";`, ["@prefab/db"]),
    ]);
    expect(violations).toHaveLength(0);
  });

  it("ignores control-plane imports outside packages/runtime entirely", () => {
    const violations = checkRuntimeContainment([
      file("apps/api/src/app.ts", `import { createPool } from "@prefab/db";`, ["@prefab/db"]),
    ]);
    expect(violations).toEqual([]);
  });
});
