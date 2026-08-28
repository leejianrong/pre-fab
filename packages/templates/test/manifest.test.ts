import { describe, expect, it } from "vitest";
import { ThemeTokensSchema, validatePageDocument } from "@prefab/schema";
import { blockSchemaRegistry } from "@prefab/blocks";
import { TEMPLATE_MANIFESTS, TemplateManifestSchema } from "../src/manifest.js";
import { loadTemplateCheckout } from "../src/server.js";

describe("template manifests", () => {
  it("has exactly eight templates, each a valid manifest (ADR-0011)", () => {
    expect(TEMPLATE_MANIFESTS).toHaveLength(8);
    for (const manifest of TEMPLATE_MANIFESTS) {
      expect(TemplateManifestSchema.safeParse(manifest).success).toBe(true);
    }
  });

  it("has no duplicate ids", () => {
    const ids = TEMPLATE_MANIFESTS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects a manifest missing a required field", () => {
    const { name: _name, ...withoutName } = TEMPLATE_MANIFESTS[0]!;
    expect(TemplateManifestSchema.safeParse(withoutName).success).toBe(false);
  });
});

describe("template checkouts (dogfoods the export format, ADR-0002/ADR-0011)", () => {
  for (const manifest of TEMPLATE_MANIFESTS) {
    it(`"${manifest.id}" has a valid theme and every block validates against the current block registry`, async () => {
      const checkout = await loadTemplateCheckout(manifest.id);

      expect(ThemeTokensSchema.safeParse(checkout.theme).success).toBe(true);
      expect(checkout.pages.length).toBeGreaterThan(0);

      for (const page of checkout.pages) {
        const result = validatePageDocument(page, blockSchemaRegistry);
        expect(result.ok, JSON.stringify(!result.ok ? result.issues : [])).toBe(true);
      }
    });
  }

  it("rejects an unknown template id", async () => {
    await expect(loadTemplateCheckout("does-not-exist")).rejects.toThrow();
  });
});
