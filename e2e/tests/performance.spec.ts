import { test, expect } from "@playwright/test";
import { authenticatedContext } from "./helpers.js";

function p95(durationsMs: number[]): number {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index]!;
}

// R2: "a save round-trips within 400 ms p95." Measured directly against
// the API a save actually goes through — the editor's own save button is
// this same call plus React state bookkeeping, so this isolates the
// number the requirement is actually about.
test("save round-trips within 400ms p95 against a seeded page", async () => {
  const { ctx, site } = await authenticatedContext("perf");
  const pageId = site.page.id;

  const SAMPLES = 20;
  const durations: number[] = [];
  let expectedVersion = site.page.version;

  for (let i = 0; i < SAMPLES; i++) {
    const startedAt = performance.now();
    const result = await ctx.api.writePage(site.site.id, pageId, {
      title: site.page.title,
      slug: site.page.slug,
      blocks: [{ ...site.page.blocks[0]!, props: { ...site.page.blocks[0]!.props, heading: `Save #${i}` } }],
      expectedVersion,
    });
    durations.push(performance.now() - startedAt);
    expectedVersion = result.version;
  }

  const p95Ms = p95(durations);
  expect(p95Ms, `save durations (ms): ${durations.map((d) => d.toFixed(1)).join(", ")}`).toBeLessThan(400);
});
