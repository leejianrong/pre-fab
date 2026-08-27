import { test, expect } from "@playwright/test";
import { API_URL, authenticatedContext } from "./helpers.js";

// SLICES.md Slice 2 (Integration): "Raw-HTML block content cannot execute
// script on the parent origin." packages/blocks/src/embed/Embed.tsx's
// mechanism is `sandbox="allow-scripts allow-popups"` with no
// `allow-same-origin` on a `srcDoc` iframe — that combination puts the
// frame on a unique, opaque origin, so script inside it can run but
// cannot reach the parent page. This proves it against a real browser,
// not just the sandbox attribute string (a unit-testable but weaker
// claim) — the embedded script actively *tries* to reach the parent and
// is asserted to fail.
test("embedded raw HTML cannot execute script against the parent page's origin", async ({ page }) => {
  const { ctx, site } = await authenticatedContext("embed-sandbox");
  const heroBlock = site.page.blocks[0]!;

  const maliciousHtml = `
    <script>
      window.__pfSandboxAttempted = true;
      try {
        window.top.document.title = "HACKED";
        window.__pfSandboxBreached = true;
      } catch (e) {
        window.__pfSandboxBlocked = String(e && e.name);
      }
      try {
        window.parent.__pfParentPwned = true;
      } catch (e) {
        // expected: cross-origin access throws
      }
    </script>
  `;

  const embedBlock = {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    type: "embed",
    parent: null,
    order: 2000,
    schemaVersion: 1,
    props: { html: maliciousHtml, height: "sm" },
    responsive: {},
  };

  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [heroBlock, embedBlock],
    expectedVersion: site.page.version,
  });

  const published = await ctx.api.publish(site.site.id);
  const originalTitle = `sandbox-test-${Date.now()}`;

  await page.goto(`${API_URL}/v1/bundles/${published.publish.contentHash}/index.html`);
  await page.evaluate((t) => {
    document.title = t;
  }, originalTitle);

  const iframe = page.locator("iframe.pf-embed-frame");
  await expect(iframe).toBeVisible();

  // Give the embedded script a moment to run and (attempt to) reach out.
  await page.waitForTimeout(500);

  const parentPwned = await page.evaluate(() => (window as unknown as { __pfParentPwned?: boolean }).__pfParentPwned);
  expect(parentPwned).toBeUndefined();
  expect(await page.title()).toBe(originalTitle);

  const sandboxAttr = await iframe.getAttribute("sandbox");
  expect(sandboxAttr).toContain("allow-scripts");
  expect(sandboxAttr).not.toContain("allow-same-origin");
});
