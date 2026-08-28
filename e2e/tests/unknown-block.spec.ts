import { readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { exportSite } from "@prefab/commands";
import { API_URL, authenticatedContext, loginInBrowser, newCheckoutDir, openSiteByName } from "./helpers.js";

// R19: "A block type unknown to the renderer is preserved in the document,
// shown as a placeholder in the editor, and skipped on the published page.
// It is never dropped." Three separate assertions, matched one-to-one to
// that sentence.
test("an unknown block type shows a placeholder in the editor, is skipped on publish, and survives export", async ({
  page,
}) => {
  const { ctx, site } = await authenticatedContext("unknown-block");
  const heroBlock = site.page.blocks[0]!;

  const unknownBlockId = "01ARZ3NDEKTSV4RRFFQ69G5FA0";
  const unknownBlock = {
    id: unknownBlockId,
    type: "not-a-real-block-type",
    parent: null,
    order: 2000,
    schemaVersion: 1,
    props: { anything: "goes", here: 42 },
    responsive: {},
  };

  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [heroBlock, unknownBlock],
    expectedVersion: site.page.version,
  });

  // 1. Shown as a placeholder in the editor.
  await loginInBrowser(page);
  await openSiteByName(page, site.site.name);
  await expect(page.locator(`[data-pf-unknown-block-id="${unknownBlockId}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`[data-pf-unknown-block-id="${unknownBlockId}"]`)).toContainText("not-a-real-block-type");

  // 2. Skipped on the published page (never crashes the rest of the page).
  const published = await ctx.api.publish(site.site.id);
  const liveHtml = await (
    await fetch(`${API_URL}/v1/bundles/${published.publish.contentHash}/index.html`)
  ).text();
  expect(liveHtml).toContain(heroBlock.props.heading);
  expect(liveHtml).not.toContain("not-a-real-block-type");

  // 3. Still present after export — never dropped.
  const dir = await newCheckoutDir();
  await exportSite.run(ctx, { siteId: site.site.id, dir });
  const exportedPage = JSON.parse(await readFile(path.join(dir, "pages", `${site.page.slug}.json`), "utf8")) as {
    blocks: Array<{ id: string; type: string; props: unknown }>;
  };
  const exportedUnknown = exportedPage.blocks.find((b) => b.id === unknownBlockId);
  expect(exportedUnknown).toBeDefined();
  expect(exportedUnknown!.type).toBe("not-a-real-block-type");
  expect(exportedUnknown!.props).toEqual(unknownBlock.props);
});
