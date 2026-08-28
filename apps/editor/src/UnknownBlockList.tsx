import type { BlockNode } from "@prefab/schema";

/**
 * R19: "A block type unknown to the renderer is preserved in the document,
 * shown as a placeholder in the editor, and skipped on the published
 * page." @prefab/puck-adapter already keeps these out of Puck's own
 * `content` (Puck's `components` config is a fixed keyed map — it cannot
 * render a type it doesn't know) and SiteEditor round-trips them
 * unmodified on every save. This is the "shown as a placeholder" half:
 * listed above the canvas rather than inline in the drop zone, since
 * Puck's canvas has no slot for a component type it can't render at all.
 */
export function UnknownBlockList({ blocks }: { blocks: BlockNode[] }) {
  if (blocks.length === 0) return null;

  return (
    <div
      style={{
        padding: "0.5rem 1rem",
        background: "#fef3c7",
        borderBottom: "1px solid #fde68a",
        fontSize: "0.875rem",
        color: "#92400e",
      }}
    >
      {blocks.map((block) => (
        <div key={block.id} data-pf-unknown-block-id={block.id} data-pf-unknown-block-type={block.type}>
          Unrecognised block type &ldquo;{block.type}&rdquo; (id {block.id}) — preserved, not shown on the canvas, and
          skipped when this page publishes.
        </div>
      ))}
    </div>
  );
}
