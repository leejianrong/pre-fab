# ADR-0014: Free-positioning layout, scoped to the page canvas

- **Status**: Proposed
- **Date**: 2026-09-03

## Context

KAN-1129 (epic PRE-E2, "Look & Feel: Compete with Squarespace") asks for a
Fluid-Engine equivalent: move, scale, rotate and opacity on blocks placed
freely on a canvas, rather than today's stacked-section model. Squarespace
markets this as the thing Wix and page builders bolt on later and never quite
get right — it is a real competitive gap, not a nice-to-have.

Today's model (`packages/schema/src/responsive.ts`, `block.ts`, `document.ts`):

- `PageDocumentSchema.blocks` is a flat, ULID-keyed list (ADR-0002). Position
  is `parent` + `order`, sorted into a stack — no x/y, no overlap, no rotation.
- `BlockResponsiveSchema` gives every block `md`/`lg` overrides limited to
  three fields (`hidden`, `spacing`, `columns`) — deliberately generic knobs a
  block renders uniformly, not a general style bag (`responsive.ts:21-29`).
- Nested containers are not fully built yet: `Columns` (`packages/blocks/src/
  columns/render.tsx`) renders `count` empty placeholder cells today; true
  nested parent/order child slots are an explicitly tracked follow-up, not
  shipped. Every block in production is currently a **page-root** child
  (`parent: null`).

This gap sits on top of ADR-0002's flat block tree, which is why KAN-1129 asks
for review before implementation rather than a build-directly ticket: getting
the representation wrong here is expensive to unwind once templates and the
canvas depend on it.

## Decision

**Free positioning is a per-page mode, applied to root-level blocks only, using
percentage-of-canvas geometry layered on the existing flat tree — not a
replacement for it.**

### Scope

This ADR covers root-level blocks (`parent: null`) only. Nested containers
(blocks-inside-blocks, e.g. a future real `Columns` child slot) are out of
scope until true nested child slots exist — see Consequences. A page opts in
per page, matching how Fluid Engine is a per-page/per-section mode in
Squarespace, not an all-or-nothing site setting.

### Schema changes

1. **`PageDocumentSchema` gains `layoutMode: "flow" | "free"`**, default
   `"flow"`. Bumps `DOCUMENT_SCHEMA_VERSION` to 2; the forward migration sets
   `layoutMode: "flow"` on any document that predates the field, so every
   existing page keeps rendering exactly as it does today with zero data
   change.

2. **`BlockNode` gains an optional `position` field**, populated only for
   root-level blocks on a `"free"` page:

   ```ts
   const FreeRectSchema = z.object({
     x: z.number().min(0).max(100),      // % of canvas width, left edge
     y: z.number().min(0).max(100),      // % of canvas height, top edge
     w: z.number().min(0).max(100),      // % of canvas width
     h: z.number().min(0).max(100),      // % of canvas height
     rotate: z.number().min(-180).max(180).default(0),
     opacity: z.number().min(0).max(1).default(1),
   });

   const FreePositionSchema = z.object({
     base: FreeRectSchema,
     md: FreeRectSchema.partial().optional(),
     lg: FreeRectSchema.partial().optional(),
   });
   ```

   `position` is required when a block's parent page is `"free"` and absent
   (and rejected by validation) when it is `"flow"` — a block never carries
   position data that nothing will read.

3. **Percentage geometry, not fixed-canvas pixels.** Squarespace's own Fluid
   Engine is pixel-offset against a fixed baseline width, scaled
   proportionally at render time — mathematically the same idea. Percentages
   skip picking an arbitrary baseline width that would otherwise have to be
   threaded through the editor, the Astro renderer and every export
   consumer, and they fall out of validation and round-trip testing for free.

4. **`parent`/`order` are kept, even on free pages.** `order` becomes the
   z-stack order (higher = on top, resolved the same way `Columns`'s
   z-stacking would be) and the fallback reading order for anything that
   isn't the visual canvas: screen readers, keyboard navigation, print,
   export/eject source order. Free positioning changes *where a block is
   drawn*, never *whether it has a well-defined document order* — dropping
   `order` would mean an agent patch has no way to say where a new block goes
   in that fallback order, which is exactly the class of problem ADR-0002
   introduced ULIDs and explicit order to avoid.

5. **Bounded fields, not a style bag.** `FreeRectSchema` is a fixed set of
   numeric fields, the same shape of decision as `ResponsiveOverrideSchema`
   already made (an enum/int/bool set, not `style: Record<string, string>`).
   This is structural geometry, not a visual value — invariant 2 ("blocks
   reference theme tokens, never raw values") is about color/spacing/type
   coming from `theme.json` so templates stay swappable; it was never a ban
   on a block knowing its own width, and `columns: number` on the existing
   `ResponsiveOverrideSchema` already establishes that structural integers
   are fine. Worth stating explicitly so this isn't misread as violating
   invariant 2 later.

### Canvas (Puck adapter)

Puck's drag-and-drop is a list-reordering model — it does not natively do
free drag/resize/rotate. Fighting it to do so would repeat the mistake
ADR-0004 already named as a risk. The proposed direction: a `"free"` page
renders its own absolute-position overlay (drag handles, resize handles, a
rotate handle) inside Puck's canvas frame in place of Puck's list DnD for
that page, writing `position` directly through the same one-write-path
mutation as every other edit (ADR-0003, invariant 1) rather than through
Puck's internal DnD reducer. Puck still owns the properties inspector,
undo/redo, and everything about `"flow"` pages. This is the kind of scoped
canvas extension ADR-0004 already anticipated ("a canvas swap, not a
framework migration") — not a reason to revisit ADR-0004 itself.

This direction is not committed in detail here; the canvas implementation is
part of KAN-1129's own scope item (3) and gets built against this schema, not
the other way around.

## Consequences

- A `"free"` page needs its own Astro render path: `position` compiles to
  `position: absolute` with percentage `inset`/`transform` on a positioned
  canvas root, generated per block the same way `responsiveStyleCss` already
  emits a scoped `<style>` block per block id (`packages/blocks/src/
  responsive.tsx`). `"flow"` pages are untouched.
- Round-trip (export → import → export, R8) must hold for `layoutMode` and
  `position` exactly as it does for every other field — no special-casing.
- Absolute positioning is an accessibility risk if visual order and DOM order
  diverge. Keeping `order` as the mandatory reading-order fallback (point 4
  above) is the mitigation; the canvas UI should warn, not silently allow, a
  visual layout whose order badly disagrees with reading order.
- Nested free-positioning (inside a container block, once real nested child
  slots exist) is deferred. When that lands, the natural extension is a
  `layoutMode` field on the container block itself, reusing `FreePosition`
  unchanged for its children — this ADR's shape should not need to change,
  only its scope to widen.
- Templates (KAN-1128) can adopt free positioning per page at their own pace;
  nothing about existing templates changes since `layoutMode` defaults to
  `"flow"`.

## Rejected

**CSS Grid template areas instead of absolute positioning.** Considered as a
lower-risk compromise — grid-based placement is easier to keep accessible and
easier to keep responsive. Rejected as the primary decision because it cannot
express overlap or rotation, which is specifically what was asked for
("Fluid-Engine-equivalent," not "a better stacked layout"). Recorded here as
the fallback if free positioning's implementation cost or accessibility risk
turns out to be worse than expected during KAN-1129's build.

**Fixed-canvas pixel coordinates** (e.g. positions authored against a fixed
1440px design width, scaled at render time). This is what Fluid Engine
actually does internally, but it requires picking one arbitrary baseline
width and threading it through the editor, renderer and every export
consumer identically or positions drift. Percentage-of-canvas geometry is the
same idea with the baseline division already done, and it's simpler to
validate and test.

**Arbitrary per-block inline styles** (`style: Record<string, string>`)
instead of a bounded `FreeRectSchema`. Rejected for the same reason
`ResponsiveOverrideSchema` is a bounded set today: an open style bag makes
"no raw values in a block" unenforceable and makes every consumer (editor,
renderer, eject target) responsible for sanitizing arbitrary CSS rather than
reading five typed numbers.

**Site-wide (rather than per-page) layout mode.** Rejected because Fluid
Engine itself is adopted per page/section in Squarespace, not as an
all-or-nothing site switch, and a per-page flag is strictly less disruptive
to existing sites — an all-or-nothing flip would force every existing page on
a site to gain or lose free positioning at once.
