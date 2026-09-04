import { describe, expect, it } from "vitest";
import { newUlid } from "../src/ids.js";
import { BlockNodeSchema } from "../src/block.js";

/**
 * ADR-0015 (KAN-1152): `scrollReveal` is a new optional-with-default field
 * on `BlockNodeSchema`, the same shape `responsive` already established —
 * see docs/BLOCK_CONTRACT.md's Versioning section for why this needs
 * neither a schema-version bump nor a migration function.
 */
describe("BlockNodeSchema scrollReveal (ADR-0015)", () => {
  function baseBlock() {
    return {
      id: newUlid(),
      type: "hero",
      parent: null,
      order: 1000,
      schemaVersion: 1,
      props: {},
    };
  }

  it("stays absent (not defaulted to false) for a block written before this field existed", () => {
    const result = BlockNodeSchema.parse(baseBlock());
    expect(result.scrollReveal).toBeUndefined();
    expect("scrollReveal" in result).toBe(false);
  });

  it("round-trips true when explicitly set", () => {
    const result = BlockNodeSchema.parse({ ...baseBlock(), scrollReveal: true });
    expect(result.scrollReveal).toBe(true);
  });

  it("round-trips false when explicitly set", () => {
    const result = BlockNodeSchema.parse({ ...baseBlock(), scrollReveal: false });
    expect(result.scrollReveal).toBe(false);
  });

  it("rejects a non-boolean value rather than coercing it", () => {
    const result = BlockNodeSchema.safeParse({ ...baseBlock(), scrollReveal: "true" });
    expect(result.success).toBe(false);
  });

  it("is byte-identical through a second parse (export -> import -> export, R8)", () => {
    const first = BlockNodeSchema.parse({ ...baseBlock(), scrollReveal: true });
    const exported = JSON.parse(JSON.stringify(first));
    const second = BlockNodeSchema.parse(exported);
    expect(second).toEqual(first);
  });
});
