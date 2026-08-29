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
    props: { heading: "Ejected and standalone", subheading: "", ctaLabel: "", ctaHref: "", background: "background" },
    responsive: {},
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
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
