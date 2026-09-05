import { describe, expect, it } from "vitest";
import { blockSchemaRegistry } from "../src/registry.js";

/**
 * Cross-cutting: every first-party block's own test file happens to include
 * a ".strict() rejects an unrecognised field" case, but that's convention,
 * not enforcement — a new block that forgets it would still pass CI. This
 * test iterates the registry itself (docs/BLOCK_CONTRACT.md), so the rule
 * holds for every block registered today and every one registered from now
 * on, with no per-block test to remember to write.
 */
describe("block contract (docs/BLOCK_CONTRACT.md)", () => {
  for (const type of blockSchemaRegistry.types()) {
    const definition = blockSchemaRegistry.get(type)!;

    it(`"${type}"'s props schema is .strict() — rejects an unrecognised field`, () => {
      const result = definition.propsSchema.safeParse({ ...definition.defaultProps, __not_a_real_field__: "x" });
      expect(result.success).toBe(false);
    });

    it(`"${type}"'s defaultProps round-trips through its own schema unchanged`, () => {
      const result = definition.propsSchema.safeParse(definition.defaultProps);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(definition.defaultProps);
    });
  }
});
