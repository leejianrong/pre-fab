import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BlockRegistry, type BlockTypeDefinition } from "../src/registry.js";
import { validatePageDocument } from "../src/validate.js";
import { newUlid } from "../src/ids.js";
import type { PageDocument } from "../src/document.js";

const titlePropsSchema = z
  .object({ text: z.string().min(1) })
  .strict();

const titleDefinition: BlockTypeDefinition<{ text: string }> = {
  type: "test.title",
  version: 1,
  propsSchema: titlePropsSchema,
  defaultProps: { text: "" },
  migrations: {},
};

function registry(): BlockRegistry {
  return new BlockRegistry().register(titleDefinition);
}

function basePage(): PageDocument {
  return {
    id: newUlid(),
    siteId: newUlid(),
    slug: "home",
    title: "Home",
    schemaVersion: 1,
    version: 0,
    blocks: [],
  };
}

describe("validatePageDocument", () => {
  it("accepts a document whose blocks satisfy their registered schema", () => {
    const blockId = newUlid();
    const page = basePage();
    page.blocks = [
      { id: blockId, type: "test.title", parent: null, order: 1000, schemaVersion: 1, props: { text: "Hello" } },
    ];

    const result = validatePageDocument(page, registry());

    expect(result.ok).toBe(true);
    expect(result.document?.blocks[0]?.props).toEqual({ text: "Hello" });
  });

  it("rejects an unknown prop field and names the block id and field path (R18)", () => {
    const blockId = newUlid();
    const page = basePage();
    page.blocks = [
      {
        id: blockId,
        type: "test.title",
        parent: null,
        order: 1000,
        schemaVersion: 1,
        props: { text: "Hello", extraField: "not allowed" },
      },
    ];

    const result = validatePageDocument(page, registry());

    expect(result.ok).toBe(false);
    expect(result.document).toBeUndefined();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ blockId });
    expect(result.issues[0]?.path).toContain("props");
  });

  it("never applies a patch partially: one bad block invalidates the whole document", () => {
    const goodId = newUlid();
    const badId = newUlid();
    const page = basePage();
    page.blocks = [
      { id: goodId, type: "test.title", parent: null, order: 1000, schemaVersion: 1, props: { text: "Good" } },
      { id: badId, type: "test.title", parent: null, order: 2000, schemaVersion: 1, props: {} },
    ];

    const result = validatePageDocument(page, registry());

    expect(result.ok).toBe(false);
    expect(result.document).toBeUndefined();
    expect(result.issues.map((i) => i.blockId)).toEqual([badId]);
  });

  it("preserves a block of an unrecognised type rather than dropping it (R19)", () => {
    const unknownId = newUlid();
    const page = basePage();
    page.blocks = [
      { id: unknownId, type: "vendor.widget", parent: null, order: 1000, schemaVersion: 1, props: { anything: true } },
    ];

    const result = validatePageDocument(page, registry());

    expect(result.ok).toBe(true);
    expect(result.document?.blocks).toHaveLength(1);
    expect(result.document?.blocks[0]).toMatchObject({ id: unknownId, type: "vendor.widget" });
  });

  it("migrates props forward before validating against the current schema", () => {
    const migratingDefinition: BlockTypeDefinition<{ text: string }> = {
      type: "test.migrating",
      version: 2,
      propsSchema: z.object({ text: z.string() }).strict(),
      defaultProps: { text: "" },
      migrations: {
        1: (props) => ({ text: String(props.legacyText ?? "") }),
      },
    };
    const reg = new BlockRegistry().register(migratingDefinition);
    const id = newUlid();
    const page = basePage();
    page.blocks = [
      { id, type: "test.migrating", parent: null, order: 1000, schemaVersion: 1, props: { legacyText: "old" } },
    ];

    const result = validatePageDocument(page, reg);

    expect(result.ok).toBe(true);
    expect(result.document?.blocks[0]?.props).toEqual({ text: "old" });
    expect(result.document?.blocks[0]?.schemaVersion).toBe(2);
  });
});
