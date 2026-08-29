import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { exportBundle } from "@prefab/commands";
import { authenticatedContext } from "./helpers.js";

// SLICES.md Slice 7 / R7: "Export is available on every plan including
// free, with no gate, no delay, and no support ticket." This codebase has
// no plan/billing gating anywhere yet (Slice 8, not built) — every account
// is the same account, so the absence of a gate here is structural, not a
// property of a specific plan flag. What this test actually pins down is
// that export-bundle (tier a) requires nothing beyond the ordinary
// per-site API token every other CLI command already uses, completes
// without any extra step, and produces a self-contained result.
test("export-bundle (tier a) completes with no gate, using the same token every other command uses (R7)", async () => {
  const { ctx, site } = await authenticatedContext("export-free");

  const outDir = await mkdtemp(path.join(tmpdir(), "pf-e2e-export-bundle-"));
  const bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-e2e-export-bundle-store-"));
  try {
    const result = await exportBundle.run(ctx, { siteId: site.site.id, outDir, bundleStoreDir });

    expect(result.contentHash).toBeTruthy();
    expect(result.manifest.format).toBe("prefab-export-manifest");
    expect(result.manifest.schemaVersion).toBeGreaterThanOrEqual(0);

    const indexHtml = await readFile(path.join(outDir, "index.html"), "utf8");
    expect(indexHtml).toContain(site.page.title);

    const manifestOnDisk = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8"));
    expect(manifestOnDisk).toEqual(result.manifest);
  } finally {
    await rm(outDir, { recursive: true, force: true });
    await rm(bundleStoreDir, { recursive: true, force: true });
  }
});
