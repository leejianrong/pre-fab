import { describe, expect, it } from "vitest";
import { BlockRegistry } from "../src/registry.js";
import { validatePageDocument } from "../src/validate.js";
import { newUlid } from "../src/ids.js";
import {
  DOCUMENT_SCHEMA_VERSION,
  PageDocumentSchema,
  migrateLegacyPageDocument,
  type PageDocument,
} from "../src/document.js";

function registry(): BlockRegistry {
  return new BlockRegistry();
}

describe("DOCUMENT_SCHEMA_VERSION", () => {
  it("is 2 (ADR-0014's document-envelope bump)", () => {
    expect(DOCUMENT_SCHEMA_VERSION).toBe(2);
  });
});

describe("migrateLegacyPageDocument (ADR-0014 / KAN-1129 forward migration)", () => {
  it("defaults a pre-migration document (no layoutMode key) to \"flow\", leaving every other field untouched", () => {
    const blockId = newUlid();
    const legacy = {
      id: newUlid(),
      siteId: newUlid(),
      slug: "home",
      title: "Home",
      schemaVersion: 1,
      version: 3,
      blocks: [
        { id: blockId, type: "hero", parent: null, order: 1000, schemaVersion: 1, props: { heading: "Hi" }, responsive: {} },
      ],
    };

    const migrated = migrateLegacyPageDocument(legacy) as Record<string, unknown>;

    expect(migrated.layoutMode).toBe("flow");
    // Every other field (blocks included) is byte-identical to the input.
    expect(migrated.blocks).toBe(legacy.blocks);
    expect(migrated.id).toBe(legacy.id);
    expect(migrated.version).toBe(legacy.version);
  });

  it("leaves a document that already has layoutMode alone", () => {
    const doc = { id: newUlid(), layoutMode: "free" };
    expect(migrateLegacyPageDocument(doc)).toBe(doc);
  });

  it("is a no-op on non-object input", () => {
    expect(migrateLegacyPageDocument(null)).toBeNull();
    expect(migrateLegacyPageDocument("not a document")).toBe("not a document");
  });

  it("parsing a pre-migration document through the full envelope schema also defaults to \"flow\" (zod's own default, exercised end to end)", () => {
    const blockId = newUlid();
    const legacy = {
      id: newUlid(),
      siteId: newUlid(),
      slug: "home",
      title: "Home",
      schemaVersion: 1,
      version: 0,
      blocks: [
        { id: blockId, type: "hero", parent: null, order: 1000, schemaVersion: 1, props: {}, responsive: {} },
      ],
    };

    const parsed = PageDocumentSchema.parse(legacy);
    expect(parsed.layoutMode).toBe("flow");
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]?.id).toBe(blockId);
  });

  it("validatePageDocument accepts a pre-migration document (no layoutMode) as \"flow\", with blocks unchanged", () => {
    const blockId = newUlid();
    const legacy = {
      id: newUlid(),
      siteId: newUlid(),
      slug: "home",
      title: "Home",
      schemaVersion: 1,
      version: 0,
      blocks: [
        { id: blockId, type: "vendor.widget", parent: null, order: 1000, schemaVersion: 1, props: { anything: true }, responsive: {} },
      ],
    };

    const result = validatePageDocument(legacy, registry());

    expect(result.ok).toBe(true);
    expect(result.document?.layoutMode).toBe("flow");
    expect(result.document?.blocks).toHaveLength(1);
    expect(result.document?.blocks[0]).toMatchObject({ id: blockId, type: "vendor.widget", props: { anything: true } });
  });
});

describe("round-trip: export -> import -> export (R8) for a \"free\" page with positioned blocks", () => {
  it("is byte-identical through validatePageDocument twice, with position and layoutMode intact", () => {
    const blockId = newUlid();
    const page: PageDocument = {
      id: newUlid(),
      siteId: newUlid(),
      slug: "home",
      title: "Home",
      schemaVersion: 2,
      version: 0,
      layoutMode: "free",
      blocks: [
        {
          id: blockId,
          type: "vendor.widget",
          parent: null,
          order: 1000,
          schemaVersion: 1,
          props: { anything: true },
          responsive: {},
          // md/lg fields are fully specified (not a genuinely partial
          // override) so this fixture is already in the same shape
          // `PageDocumentSchema` would produce from a first parse — zod's
          // `.default()` on `rotate`/`opacity` fills those in even under
          // `FreeRectSchema.partial()` (ADR-0014's exact specified shape)
          // whenever a partial override omits them, so a hand-authored
          // object with a genuinely partial `md`/`lg` isn't yet in
          // "as-persisted" form and isn't the right fixture for a
          // byte-identical round-trip assertion.
          position: {
            base: { x: 10, y: 20, w: 30, h: 40, rotate: 15, opacity: 0.5 },
            md: { x: 12, y: 20, w: 30, h: 40, rotate: 15, opacity: 0.5 },
            lg: { x: 12, y: 20, w: 50, h: 40, rotate: -20, opacity: 0.5 },
          },
        },
      ],
    };

    // "export": serialize to JSON exactly the way a checkout file would be.
    const exported1 = JSON.stringify(page);

    // "import": parse it back through the same validation any other write goes through.
    const firstImport = validatePageDocument(JSON.parse(exported1), registry());
    expect(firstImport.ok).toBe(true);

    // "export" again.
    const exported2 = JSON.stringify(firstImport.document);

    // "import" once more, to prove a second round-trip is stable too.
    const secondImport = validatePageDocument(JSON.parse(exported2), registry());
    expect(secondImport.ok).toBe(true);
    const exported3 = JSON.stringify(secondImport.document);

    expect(exported2).toEqual(exported1);
    expect(exported3).toEqual(exported2);
    expect(secondImport.document?.layoutMode).toBe("free");
    expect(secondImport.document?.blocks[0]?.position).toEqual(page.blocks[0]?.position);
  });

  it("documents a zod quirk: a genuinely partial md/lg override still gets rotate/opacity defaulted on first parse", () => {
    // ADR-0014 specifies `md`/`lg` as `FreeRectSchema.partial().optional()`.
    // `rotate`/`opacity` carry `.default()` on the un-partialed FreeRectSchema,
    // and zod's default still fires for an absent key even once the field is
    // wrapped `.optional()` by `.partial()` — so a caller sending only
    // `{ x: 12 }` for `md` gets back `{ x: 12, rotate: 0, opacity: 1 }`, not
    // `{ x: 12 }`. This is stable after the first parse (a value already in
    // this fattened shape parses back to itself unchanged, per the
    // round-trip test above) but worth calling out: it means a "partial"
    // md/lg override can never omit rotate/opacity from what's actually
    // stored, only from what a caller bothers to send once.
    const page: PageDocument = {
      id: newUlid(),
      siteId: newUlid(),
      slug: "home",
      title: "Home",
      schemaVersion: 2,
      version: 0,
      layoutMode: "free",
      blocks: [
        {
          id: newUlid(),
          type: "vendor.widget",
          parent: null,
          order: 1000,
          schemaVersion: 1,
          props: {},
          responsive: {},
          position: { base: { x: 0, y: 0, w: 10, h: 10, rotate: 0, opacity: 1 }, md: { x: 12 } },
        },
      ],
    };

    const result = validatePageDocument(page, registry());

    expect(result.ok).toBe(true);
    expect(result.document?.blocks[0]?.position?.md).toEqual({ x: 12, rotate: 0, opacity: 1 });
  });
});
