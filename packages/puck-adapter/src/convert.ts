import type { ComponentData, Data } from "@puckeditor/core";
import { childrenOf, reorderChildren, type BlockNode, type PageDocument } from "@prefab/schema";
import { PuckIdBridge } from "./id-bridge.js";

/**
 * The spike's central finding (ADR-0004): Puck's canonical `Data` shape is
 * `{ root, content: ComponentData[], zones? }` — position is array index
 * within a named zone, not an explicit `parent` + `order` pair. It is not
 * our flat model, but for slice 1's non-nested Hero page the two are
 * isomorphic: every block has `parent: null`, so `content` is exactly the
 * top-level children sorted by `order`, and Puck's per-item `props.id`
 * (which it requires — `WithId<Props>`) is exactly our block id. Nested
 * blocks (Slice 2+, e.g. a Columns block with child slots) will need a
 * `zones` entry keyed by `${parentId}:<slot>`, which our `parent` field
 * maps onto directly — the adapter absorbs the shape difference without a
 * schema change on our side.
 *
 * A block whose type Puck has no registered component for cannot be
 * rendered inside Puck's canvas at all (`config.components` is a fixed
 * keyed map, not open-ended) — so it is deliberately left out of `content`
 * rather than dropped from the document (R19). apps/editor renders those
 * separately, outside the Puck canvas, as the "unknown block" placeholder.
 */

export interface PuckSplit {
  puckData: Data;
  /** Blocks of a type Puck's config does not know how to render — preserved, never sent into Puck. */
  unknownBlocks: BlockNode[];
}

export function pageDocumentToPuckData(doc: PageDocument, knownTypes: Set<string>): PuckSplit {
  const topLevel = childrenOf(doc.blocks, null);
  const known = topLevel.filter((b) => knownTypes.has(b.type));
  const unknownBlocks = topLevel.filter((b) => !knownTypes.has(b.type));

  return {
    puckData: {
      root: { props: { title: doc.title } },
      content: known.map(blockToComponentData),
      zones: {},
    },
    unknownBlocks,
  };
}

function blockToComponentData(block: BlockNode): ComponentData {
  return {
    type: block.type,
    props: { id: block.id, ...block.props },
  } as ComponentData;
}

export function puckDataToPageDocument(
  data: Data,
  base: PageDocument,
  unknownBlocks: BlockNode[],
  idBridge: PuckIdBridge,
): PageDocument {
  const previousById = new Map(base.blocks.map((b) => [b.id, b]));

  const known = data.content.map((item, index) =>
    componentDataToBlock(item, index, previousById, idBridge),
  );
  const orderedKnownIds = known.map((b) => b.id);
  const reordered = orderedKnownIds.length > 0 ? reorderChildren(known, null, orderedKnownIds) : known;

  const rootTitle = data.root.props?.title ?? (data.root as { title?: unknown }).title;
  const title = typeof rootTitle === "string" ? rootTitle : base.title;

  return {
    ...base,
    title,
    blocks: [...reordered, ...unknownBlocks],
  };
}

function componentDataToBlock(
  item: ComponentData,
  index: number,
  previousById: Map<string, BlockNode>,
  idBridge: PuckIdBridge,
): BlockNode {
  const { id: rawId, ...props } = item.props as { id: string } & Record<string, unknown>;
  const id = idBridge.resolve(rawId);
  const previous = previousById.get(id);

  return {
    id,
    type: item.type,
    parent: null,
    // Placeholder order — reorderChildren (called by the caller) renumbers
    // the whole set from this array position with a clean gap.
    order: (index + 1) * 1000,
    schemaVersion: previous?.schemaVersion ?? 1,
    props,
    // Puck's canvas has no responsive-override UI of its own (Slice 2's
    // breakpoint overrides are edited outside the Puck drop zone) — so a
    // block that already had overrides keeps them across a canvas edit,
    // and a genuinely new block starts with none.
    responsive: previous?.responsive ?? {},
    // ADR-0014 / KAN-1129: same reasoning as `responsive` above — Puck's
    // canvas has no free-positioning UI of its own either (that's
    // free-canvas.tsx, layered outside Puck's own content editing), so a
    // canvas edit that doesn't touch positioning (e.g. changing an
    // unrelated block's text prop) must not silently drop this block's
    // `position`. Carried forward only when present: a block with no prior
    // position (a "flow" page, or a brand-new block) stays without one,
    // since `position` must be *absent*, never `undefined`-but-present,
    // wherever validatePageDocument doesn't require it (an explicit key
    // with value `undefined` still fails `"position" in block` checks
    // inconsistently across engines/serialization, so we just omit it).
    ...(previous?.position !== undefined ? { position: previous.position } : {}),
    // ADR-0015 / KAN-1152: same reasoning and same "omit, don't default"
    // shape as `position` immediately above — Puck's canvas has no
    // scroll-reveal UI of its own, so a canvas edit that doesn't touch it
    // must not silently turn a block's reveal opt-in back off, and a block
    // that never had the field stays without it rather than gaining an
    // explicit `false`.
    ...(previous?.scrollReveal !== undefined ? { scrollReveal: previous.scrollReveal } : {}),
  };
}
