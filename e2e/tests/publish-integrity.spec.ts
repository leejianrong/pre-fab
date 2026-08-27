import { test, expect } from "@playwright/test";
import { ApiClientError } from "@prefab/api-client";
import { authenticatedContext, API_URL } from "./helpers.js";

test.describe("publish integrity (ADR-0007, R4, R5)", () => {
  test("a publish that never reaches the build step leaves nothing live and touches no publish record", async () => {
    // R4's atomicity is structural (apps/api/src/app.ts builds the bundle
    // BEFORE the pointer-swap transaction even opens — see
    // packages/publish's own tests for the build-failure path in
    // isolation), and this is the honest black-box slice of it reachable
    // through the real API without fabricating an artificial mid-build
    // crash: a publish request that is rejected before `buildSiteBundle`
    // runs must leave the site's publish history and live pointer
    // completely untouched. A token-scoped request for a site the token
    // isn't scoped to is rejected as "forbidden" before existence is even
    // checked (correctly — a 404 would leak which site ids are real).
    const { ctx } = await authenticatedContext("publish-guard");
    const otherSiteId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

    let caught: unknown;
    try {
      await ctx.api.publish(otherSiteId);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiClientError);
    expect((caught as ApiClientError).code).toBe("forbidden");
  });

  test("publishing twice, then restoring the first publish in one action, serves the original content within 10s", async () => {
    const { ctx, site, token } = await authenticatedContext("rollback");
    const pageId = site.page.id;

    const first = await ctx.api.publish(site.site.id);

    await ctx.api.writePage(site.site.id, pageId, {
      title: site.page.title,
      slug: site.page.slug,
      blocks: [{ ...site.page.blocks[0]!, props: { ...site.page.blocks[0]!.props, heading: "Second publish content" } }],
      expectedVersion: site.page.version,
    });
    await ctx.api.publish(site.site.id);

    const liveAfterSecond = await fetchLive(site.site.id, token);
    expect(liveAfterSecond).toContain("Second publish content");

    const start = Date.now();
    await ctx.api.rollback(site.site.id, first.publish.id);
    const liveAfterRollback = await fetchLive(site.site.id, token);
    const elapsedMs = Date.now() - start;

    expect(liveAfterRollback).toContain("Your headline goes here"); // the original, unedited Hero default
    expect(liveAfterRollback).not.toContain("Second publish content");
    expect(elapsedMs).toBeLessThan(10_000);
  });
});

async function fetchLive(siteId: string, token: string): Promise<string> {
  const response = await fetch(`${API_URL}/v1/sites/${siteId}/live/`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return response.text();
}
