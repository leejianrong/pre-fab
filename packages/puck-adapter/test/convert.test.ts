import { describe, expect, it } from "vitest";
import type { Data } from "@puckeditor/core";
import { createEmptyPage, newUlid, type BlockNode } from "@prefab/schema";
import { HERO_BLOCK_TYPE, heroDefaultProps } from "@prefab/blocks";
import { pageDocumentToPuckData, puckDataToPageDocument } from "../src/convert.js";
import { PuckIdBridge } from "../src/id-bridge.js";

const KNOWN_TYPES = new Set([HERO_BLOCK_TYPE]);

function heroBlock(overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id: newUlid(),
    type: HERO_BLOCK_TYPE,
    parent: null,
    order: 1000,
    schemaVersion: 1,
    props: { ...heroDefaultProps },
    ...overrides,
  };
}

describe("pageDocumentToPuckData / puckDataToPageDocument", () => {
  it("round-trips a known block with its ULID preserved as Puck's props.id", () => {
    const page = createEmptyPage({ id: newUlid(), siteId: newUlid(), slug: "home", title: "Home" });
    const block = heroBlock();
    page.blocks = [block];

    const { puckData, unknownBlocks } = pageDocumentToPuckData(page, KNOWN_TYPES);
    expect(unknownBlocks).toEqual([]);
    expect(puckData.content).toHaveLength(1);
    expect(puckData.content[0]?.props.id).toBe(block.id);
    expect(puckData.content[0]?.type).toBe(HERO_BLOCK_TYPE);

    const roundTripped = puckDataToPageDocument(puckData, page, [], new PuckIdBridge());
    expect(roundTripped.blocks).toHaveLength(1);
    expect(roundTripped.blocks[0]?.id).toBe(block.id);
    expect(roundTripped.blocks[0]?.props).toEqual(block.props);
  });

  it("preserves content order via array position", () => {
    const page = createEmptyPage({ id: newUlid(), siteId: newUlid(), slug: "home", title: "Home" });
    const first = heroBlock({ order: 1000, props: { ...heroDefaultProps, heading: "First" } });
    const second = heroBlock({ order: 2000, props: { ...heroDefaultProps, heading: "Second" } });
    page.blocks = [second, first]; // deliberately out of order in storage

    const { puckData } = pageDocumentToPuckData(page, KNOWN_TYPES);

    expect(puckData.content.map((c) => c.props.heading)).toEqual(["First", "Second"]);
  });

  it("mints a stable ULID for a component Puck created with its own id, and keeps it stable across the session", () => {
    const page = createEmptyPage({ id: newUlid(), siteId: newUlid(), slug: "home", title: "Home" });
    const bridge = new PuckIdBridge();
    const puckGeneratedId = `${HERO_BLOCK_TYPE}-not-a-ulid`;

    const data = {
      root: { props: { title: "Home" } },
      content: [{ type: HERO_BLOCK_TYPE, props: { id: puckGeneratedId, ...heroDefaultProps } }],
      zones: {},
    };

    const first = puckDataToPageDocument(data as Data, page, [], bridge);
    const second = puckDataToPageDocument(data as Data, first, [], bridge);

    expect(first.blocks[0]?.id).toBeTruthy();
    expect(second.blocks[0]?.id).toBe(first.blocks[0]?.id);
  });

  it("keeps a block of an unknown type out of Puck's content but never drops it (R19)", () => {
    const page = createEmptyPage({ id: newUlid(), siteId: newUlid(), slug: "home", title: "Home" });
    const known = heroBlock({ order: 1000 });
    const unknown: BlockNode = {
      id: newUlid(),
      type: "vendor.widget",
      parent: null,
      order: 2000,
      schemaVersion: 1,
      props: { anything: true },
    };
    page.blocks = [known, unknown];

    const { puckData, unknownBlocks } = pageDocumentToPuckData(page, KNOWN_TYPES);
    expect(puckData.content).toHaveLength(1);
    expect(unknownBlocks).toEqual([unknown]);

    const roundTripped = puckDataToPageDocument(puckData, page, unknownBlocks, new PuckIdBridge());
    expect(roundTripped.blocks.map((b) => b.id).sort()).toEqual([known.id, unknown.id].sort());
    expect(roundTripped.blocks.find((b) => b.id === unknown.id)).toEqual(unknown);
  });

  it("carries the page title through root.props.title", () => {
    const page = createEmptyPage({ id: newUlid(), siteId: newUlid(), slug: "home", title: "Old title" });
    const { puckData } = pageDocumentToPuckData(page, KNOWN_TYPES);
    puckData.root.props = { ...puckData.root.props, title: "New title" };

    const result = puckDataToPageDocument(puckData, page, [], new PuckIdBridge());
    expect(result.title).toBe("New title");
  });
});
