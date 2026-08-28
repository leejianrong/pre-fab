import { newUlid } from "./ids.js";
import type { BlockNode } from "./block.js";
import type { PageDocument } from "./document.js";

/**
 * Fork-on-use (ADR-0011): every block and page — and the site itself, by
 * the caller doing the same for `site.id` — gets a fresh ULID, so two forks
 * of one template never collide and editing one can never reach the other
 * (SLICES.md Slice 3: "forking a template twice yields two independent
 * sites"). This is deliberately NOT `push` (packages/commands/checkout.ts),
 * which preserves ids on purpose so a site round-trips back to itself
 * (R8) — forking is the opposite requirement on the same file shape.
 *
 * No first-party block prop references another block's or page's id (nav
 * links are plain `href` strings, images are plain URLs — see
 * packages/blocks) — so re-keying only ever has to walk the block tree's
 * own `id`/`parent` edges, never chase into `props`.
 */
export function rekeyBlocks(blocks: BlockNode[]): BlockNode[] {
  const idMap = new Map<string, string>();
  for (const block of blocks) idMap.set(block.id, newUlid());

  return blocks.map((block) => {
    if (block.parent !== null && !idMap.has(block.parent)) {
      throw new Error(`rekeyBlocks: block "${block.id}" has parent "${block.parent}" outside this page's block list`);
    }
    return {
      ...block,
      id: idMap.get(block.id)!,
      parent: block.parent === null ? null : (idMap.get(block.parent) as string),
    };
  });
}

/** Rekeys one page for a fork: fresh page id (assigned by the caller, e.g. server-minted), the given site id, reset version, and every block rekeyed. */
export function rekeyPageForFork(
  page: PageDocument,
  input: { siteId: string; pageId: string },
): PageDocument {
  return {
    ...page,
    id: input.pageId,
    siteId: input.siteId,
    version: 0,
    blocks: rekeyBlocks(page.blocks),
  };
}
