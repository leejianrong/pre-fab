import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { exportSite, push } from "@prefab/commands";
import { authenticatedContext, newCheckoutDir } from "./helpers.js";

// R8, and ADR-0002's reason the file-tree projection is trusted: "export →
// import → export" must be byte-identical, or the portability promise is
// a lossy afterthought like the incumbents'.
test("export → import → export produces byte-identical output", async () => {
  const { ctx, site } = await authenticatedContext("round-trip");

  const dir1 = await newCheckoutDir();
  await exportSite.run(ctx, { siteId: site.site.id, dir: dir1 });

  // "Import" is pushing a checkout back — re-importing an unmodified
  // export must be a true no-op (ADR-0002's Terraform-shaped apply).
  await push.run(ctx, { dir: dir1 });

  const dir2 = await newCheckoutDir();
  await exportSite.run(ctx, { siteId: site.site.id, dir: dir2 });

  const files1 = (await readdir(path.join(dir1, "pages"))).sort();
  const files2 = (await readdir(path.join(dir2, "pages"))).sort();
  expect(files2).toEqual(files1);

  for (const file of files1) {
    const [a, b] = await Promise.all([
      readFile(path.join(dir1, "pages", file), "utf8"),
      readFile(path.join(dir2, "pages", file), "utf8"),
    ]);
    expect(b).toBe(a);
  }

  const [theme1, theme2, site1, site2] = await Promise.all([
    readFile(path.join(dir1, "theme.json"), "utf8"),
    readFile(path.join(dir2, "theme.json"), "utf8"),
    readFile(path.join(dir1, "site.json"), "utf8"),
    readFile(path.join(dir2, "site.json"), "utf8"),
  ]);
  expect(theme2).toBe(theme1);
  expect(site2).toBe(site1);
});
