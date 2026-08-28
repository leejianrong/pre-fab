import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { pull, push } from "@prefab/commands";
import { newUlid } from "@prefab/schema";
import { POSTDETAIL_BLOCK_TYPE, postDetailDefaultProps } from "@prefab/blocks";
import { API_URL, authenticatedContext, loginInBrowser, newCheckoutDir, openSiteByName } from "./helpers.js";

// SLICES.md Slice 5's demo: "Write a post in the editor, publish it, see it
// on an index page with an RSS feed — then edit the same post as a file via
// `prefab pull`." (RSS/index coverage lives in blog-feeds.spec.ts; this is
// the editor + file-projection half.)
test("creating, publishing and reading a post through the editor, then editing the same post as a file and pushing it back", async ({
  page,
  request,
}) => {
  const { ctx, site, token } = await authenticatedContext("blog-editor");

  // A "blog" page carrying a postdetail block — the per-post route
  // template (SLICES.md's list/detail block types) — set up via the API
  // the same way block-library.spec.ts assembles test pages, since dragging
  // a block into the Puck canvas isn't what this test is about.
  const blogPage = await ctx.api.createPage(site.site.id, { slug: "blog", title: "Blog" });
  await ctx.api.writePage(site.site.id, blogPage.id, {
    title: "Blog",
    slug: "blog",
    blocks: [
      { id: newUlid(), type: POSTDETAIL_BLOCK_TYPE, parent: null, order: 1000, schemaVersion: 1, props: { ...postDetailDefaultProps }, responsive: {} },
    ],
    expectedVersion: blogPage.version,
  });

  await loginInBrowser(page);
  await openSiteByName(page, site.site.name);

  await page.getByRole("button", { name: /^blog$/i }).click();
  const blogDialog = page.getByRole("dialog", { name: /blog posts/i });
  await expect(blogDialog).toBeVisible();

  await blogDialog.getByLabel(/^title$/i).fill("Hello from the editor");
  await blogDialog.getByLabel(/body \(markdown\)/i).fill("First paragraph written in the editor.");
  await blogDialog.getByLabel(/^status$/i).selectOption("published");
  await blogDialog.getByRole("button", { name: /create post/i }).click();
  await expect(blogDialog.getByRole("button", { name: /^save post$/i })).toBeVisible({ timeout: 10_000 });
  await expect(blogDialog.getByText("Hello from the editor")).toBeVisible();

  await blogDialog.getByRole("button", { name: /close blog panel/i }).click();

  const myHeader = page.locator("header").first();
  await myHeader.getByRole("button", { name: /^publish$/i }).click();
  await expect(myHeader).toContainText("Live", { timeout: 15_000 });

  // A site's first publish shows a celebration dialog (SiteEditor.tsx) that
  // would otherwise sit on top of everything else — dismiss it before
  // interacting with the page further.
  const celebration = page.getByRole("dialog", { name: /site published/i });
  if (await celebration.isVisible().catch(() => false)) {
    await celebration.getByRole("button", { name: /keep editing/i }).click();
  }

  const posts = await ctx.api.listPosts(site.site.id, {});
  const post = posts.posts.find((p) => p.title === "Hello from the editor");
  expect(post).toBeDefined();

  const liveResponse = await request.get(`${API_URL}/v1/sites/${site.site.id}/live/blog/${post!.slug}/`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(liveResponse.status()).toBe(200);
  const liveHtml = await liveResponse.text();
  expect(liveHtml).toContain("Hello from the editor");
  expect(liveHtml).toContain("First paragraph written in the editor.");

  // Now edit the same post as a file (ADR-0002's bidirectional projection)
  // and push it back — the same pull-edit-push loop pull-push.spec.ts
  // proves for pages, applied here to posts.
  const dir = await newCheckoutDir();
  await pull.run(ctx, { siteId: site.site.id, dir });

  const postFilePath = path.join(dir, "posts", `${post!.slug}.md`);
  const fileContents = await readFile(postFilePath, "utf8");
  expect(fileContents).toContain("Hello from the editor");
  const edited = fileContents.replace("First paragraph written in the editor.", "Edited as a file, then pushed back.");
  await writeFile(postFilePath, edited, "utf8");

  await push.run(ctx, { dir });

  const updated = await ctx.api.getPost(site.site.id, post!.id);
  expect(updated.body).toContain("Edited as a file, then pushed back.");

  // Reopening the editor's blog panel reflects the file-based edit too —
  // there is exactly one write path (ADR-0003), so the canvas/panel and a
  // hand-edited file can never drift.
  await page.getByRole("button", { name: /^blog$/i }).click();
  await expect(page.getByRole("dialog", { name: /blog posts/i }).getByText("Hello from the editor")).toBeVisible();
});
