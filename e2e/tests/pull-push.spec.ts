import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { pull, push } from "@prefab/commands";
import { authenticatedContext, canvasFrame, loginInBrowser, newCheckoutDir } from "./helpers.js";

// SLICES.md: "Run `prefab pull` and see the change in a file. Edit the
// file, `prefab push`, watch the canvas update." — the file-tree
// projection (ADR-0002) is round-trip-consistent with the canvas, not a
// separate, drifting representation.
test("prefab pull, edit the file, prefab push — the canvas shows the change on reload", async ({ page }) => {
  const { ctx, site } = await authenticatedContext("pull-push");
  const dir = await newCheckoutDir();

  await pull.run(ctx, { siteId: site.site.id, dir });

  const pageFilePath = path.join(dir, "pages", "home.json");
  const document = JSON.parse(await readFile(pageFilePath, "utf8"));
  document.blocks[0].props.heading = "Edited as a file, then pushed";
  await writeFile(pageFilePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  await push.run(ctx, { dir });

  await loginInBrowser(page);
  await page.getByRole("button", { name: new RegExp(site.site.name, "i") }).click();

  const frame = canvasFrame(page);
  await expect(frame.getByText("Edited as a file, then pushed")).toBeVisible({ timeout: 15_000 });
});
