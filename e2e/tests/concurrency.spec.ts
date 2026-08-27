import { test, expect } from "@playwright/test";
import { ApiClientError } from "@prefab/api-client";
import { authenticatedContext } from "./helpers.js";

test.describe("integrity (ADR-0006, R17, R18)", () => {
  test("a write carrying a stale base version is rejected with a diff, and the earlier write survives intact", async () => {
    const { ctx, site } = await authenticatedContext("stale-write");
    const pageId = site.page.id;

    const first = await ctx.api.writePage(site.site.id, pageId, {
      title: "First writer wins",
      slug: site.page.slug,
      blocks: site.page.blocks,
      expectedVersion: site.page.version,
    });
    expect(first.title).toBe("First writer wins");

    let caught: unknown;
    try {
      await ctx.api.writePage(site.site.id, pageId, {
        title: "Second writer, stale version",
        slug: site.page.slug,
        blocks: site.page.blocks,
        expectedVersion: site.page.version, // deliberately stale — first already advanced it
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiClientError);
    const apiError = caught as ApiClientError;
    expect(apiError.code).toBe("conflict");
    const conflict = apiError.asConflict();
    expect(conflict?.current.title).toBe("First writer wins");
    expect(conflict?.diff.fields.some((f) => f.field === "title")).toBe(true);

    const stillThere = await ctx.api.getPage(site.site.id, pageId);
    expect(stillThere.title).toBe("First writer wins");
  });

  test("a patch containing one valid and one invalid block change applies neither", async () => {
    const { ctx, site } = await authenticatedContext("partial-patch");
    const pageId = site.page.id;
    const originalHeading = site.page.blocks[0]!.props.heading;

    let caught: unknown;
    try {
      await ctx.api.writePage(site.site.id, pageId, {
        title: site.page.title,
        slug: site.page.slug,
        blocks: [
          { ...site.page.blocks[0]!, props: { ...site.page.blocks[0]!.props, heading: "This one is valid" } },
          // A second, bogus block with an unrecognised prop — the whole document must fail validation.
          {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            type: "hero",
            parent: null,
            order: 2000,
            schemaVersion: 1,
            props: { heading: "valid-ish", notARealField: true },
          },
        ],
        expectedVersion: site.page.version,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiClientError);
    expect((caught as ApiClientError).code).toBe("validation_error");

    const unchanged = await ctx.api.getPage(site.site.id, pageId);
    expect(unchanged.blocks).toHaveLength(1);
    expect(unchanged.blocks[0]!.props.heading).toBe(originalHeading);
  });
});
