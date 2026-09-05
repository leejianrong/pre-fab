import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { newUlid } from "@prefab/schema";
import { eject } from "@prefab/commands";
import { authenticatedContext } from "./helpers.js";

const execFileAsync = promisify(execFile);

function heroBlock(id: string) {
  return {
    id,
    type: "hero",
    parent: null,
    order: 1000,
    schemaVersion: 1,
    props: { heading: "Ejected and standalone", subheading: "", ctaLabel: "", ctaHref: "", background: "background", backgroundImage: "" },
    responsive: {},
    // ADR-0015 / KAN-1152: proves the scroll-reveal mechanism actually
    // reaches the ejected build, not just that eject still works in
    // general — packages/blocks/src (including scroll-reveal.tsx) is
    // copied wholesale by `ejectSite`, and the vendored @prefab/schema
    // shim's `BlockNode` type needs `scrollReveal` for this ejected
    // project's own `npm run build` (real Astro, real tsc, zero
    // pre-fab packages) to compile and render it at all.
    scrollReveal: true,
  };
}

// SLICES.md Slice 7 demo / R11: "An ejected project builds and runs with
// `npm install && npm run build`, with no pre-fab package present at
// runtime."
test("an ejected project builds and runs with npm install && npm run build, with no pre-fab package required at runtime (R11)", async () => {
  test.setTimeout(180_000);

  const { ctx, site } = await authenticatedContext("eject");
  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [heroBlock(newUlid())],
    expectedVersion: site.page.version,
  });

  const outDir = await mkdtemp(path.join(tmpdir(), "pf-e2e-eject-"));
  try {
    await eject.run(ctx, { siteId: site.site.id, outDir });

    const packageJson = JSON.parse(await readFile(path.join(outDir, "package.json"), "utf8"));
    const dependencyNames = Object.keys(packageJson.dependencies ?? {});
    expect(dependencyNames.some((name) => name.startsWith("@prefab/"))).toBe(false);

    await execFileAsync("npm", ["install"], { cwd: outDir });
    await execFileAsync("npm", ["run", "build"], { cwd: outDir });

    const html = await readFile(path.join(outDir, "dist", "index.html"), "utf8");
    expect(html).toContain("Ejected and standalone");
    // ADR-0015 / KAN-1152: the scroll-reveal attribute and its shared
    // CSS/script asset both made it through a real, independent Astro
    // build with no @prefab/* package installed.
    expect(html).toContain("data-pf-reveal");
    expect(html).toContain("IntersectionObserver");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
