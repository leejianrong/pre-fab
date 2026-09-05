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
 *
 * Tertiary container, not error — base M3 has no dedicated "warning"
 * family, and tertiary's own spec purpose ("bring heightened attention to
 * an element") fits an unusual-but-not-broken state better than borrowing
 * error semantics for something that isn't a failure.
 */
export function UnknownBlockList({ blocks }: { blocks: BlockNode[] }) {
  if (blocks.length === 0) return null;

  return (
    <div
      style={{
        padding: "0.5rem 1rem",
        background: "var(--md-sys-color-tertiary-container)",
        color: "var(--md-sys-color-on-tertiary-container)",
        borderBottom: "1px solid var(--md-sys-color-outline-variant)",
        fontFamily: "var(--md-ref-typeface-plain)",
        fontSize: "var(--md-sys-typescale-body-medium-size)",
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
