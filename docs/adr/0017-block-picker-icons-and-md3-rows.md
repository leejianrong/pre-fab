# ADR-0017: Block-picker icons, hover preview, and MD3 row alignment

- **Status**: Accepted
- **Date**: 2026-09-06
- **Fork**: KAN-1207 (widened by PM decision, per KAN-1203's audit)

## Context

KAN-1203's audit confirmed the premise: entries in the Puck canvas's block
drawer (`packages/puck-adapter/src/config.tsx`'s `BLOCK_ENTRIES`) render only
a text `label` — no icon, no preview — and flagged that this drawer is still
Puck's own stock, unstyled `puck.css` (KAN-1205 only suppressed Puck's
*header*, not this list). The PM decision widened KAN-1207 to bring the row's
shape/spacing/state-layer into MD3 alignment alongside adding icons, rather
than shipping MD3 icons onto still-stock rows. This is editor-tooling-only —
no schema, publish-pipeline, or published-site behavior changes — so this
note stays proportionally smaller than ADR-0014/0015.

Three constraints, checked directly against `@puckeditor/core@0.23.0`'s
shipped `.d.ts`/`.js`/`.css` rather than assumed:

- **`ComponentConfig` has no icon field**, and `label` is typed strictly
  `string` (no `ReactNode`). No per-component drawer-render hook exists on
  `ComponentConfig` itself.
- **`overrides.drawerItem`** (`RenderFunc<{ children: ReactNode; name: string
  }>`) is the only extension point. Traced in the compiled source:
  `ComponentListItem` renders `<Drawer.Item name label>` → `DrawerItemInner`,
  whose default inner content is a name-label div plus Puck's own drag-grip
  icon. When `overrides.drawerItem` is set, it becomes `CustomInner`, called
  as `<CustomInner name>{defaultLabelAndDragIconMarkup}</CustomInner>` —
  it replaces/wraps the row's *inner* content, not the outer row element
  Puck itself renders (the div carrying padding, hover background, border).
  That outer div also carries a `data-puck-drawer-item="true"` attribute and
  is rendered **twice** per block type (a `pointer-events: none`
  `draggableBg` copy behind, used for the drag-ghost image, and an
  interactive `draggableFg` copy on top) — confirmed by counting
  `[data-puck-drawer-item]` elements in a running editor (44 for 22 block
  types).
- **Puck exposes the outer row's styling as CSS custom properties**:
  `--puck-drawer-item-{radius,space,border-width,color-border,color-bg,
  color-bg-hover,color-text,color-text-hover,font-size}`, declared (with
  fallbacks) directly in the row's own compiled CSS rule and consumed via
  `var(--puck-drawer-item-x, var(--puck-x-fallback))`. This is Puck's own
  public theming mechanism for this exact row, not an internal
  implementation detail — a real alternative to fighting its hashed
  CSS-module class names (`_DrawerItem-draggable_1n90m_22` etc., confirmed
  present in the shipped `index.css`, deterministic for this pinned version
  but not human-stable across a version bump).

## Decision

### 1. Icon: an out-of-band lookup on `BLOCK_ENTRIES`, not on Puck's config

`BlockEntry` (`packages/puck-adapter/src/config.tsx`) gains an `icon: string`
field — a plain unicode glyph/emoji per entry (🦸 Hero, 🔤 Heading, 🔘 Button,
`</>` Embed, ↕ Spacer, 📝 Rich text, 🦶 Footer, 🧭 Nav, 💬 Testimonial, ❓ FAQ,
📇 Contact details, 🗺️ Map embed, 🖼️ Image, 🎞️ Gallery, ▥ Columns, ▦ Card
grid, 📚 Post list, 📄 Post detail, 📋 Form, 🎟️ Event sign-up, 💳 Payment, 🔁
Subscription) — matching the "no icon font/SVG set loaded" call
`apps/editor/src/ui/IconButton.tsx` already made for this app's chrome (R16,
offline-friendliness). `registerBlock` never forwards it into the
`ComponentConfig` it builds for Puck (Puck has nowhere to put it). Instead
it's exported as `BLOCK_ICONS: Record<string, string>` (type → icon),
built from the same `BLOCK_ENTRIES` Puck's own config is built from, so
label/icon/render never drift into two separately maintained tables.
`apps/editor/src/SiteEditor.tsx` looks it up inside `overrides.drawerItem`
and renders it beside Puck's own `children` (the label + drag-icon content),
matching the pattern KAN-1205 already established for touching Puck chrome
via a React-level override rather than a CSS override.

### 2. Row-level MD3 alignment: Puck's own CSS custom properties, not its hashed classes

`overrides.drawerItem`'s wrapper doesn't reach the outer row div, so shape/
spacing/state-layer had to land some other way. Given Puck already exposes
`--puck-drawer-item-*` as its own theming seam for precisely this row, the
row's MD3 alignment is a set of variable overrides
(`apps/editor/src/ui/tokens.css`), not a fight with hashed class names:

```css
.pf-puck-canvas {
  --puck-drawer-item-radius: var(--md-sys-shape-corner-medium);
  --puck-drawer-item-space: 0.625rem 0.875rem;
  --puck-drawer-item-color-bg-hover: color-mix(in srgb,
    var(--md-sys-color-on-surface) calc(var(--md-sys-state-hover-state-layer-opacity) * 100%),
    var(--md-sys-color-surface));
  /* ...border/text/font-size, see tokens.css */
}
```

Scoped to `.pf-puck-canvas` (the div wrapping `<Puck>` in `SiteEditor.tsx`),
not `:root` — `--puck-space-3`/`--puck-radius-m` (the generic fallbacks these
same rules cascade to) are shared by other Puck chrome this ticket doesn't
touch, and item-specific vars keep the change scoped to exactly this row.
Puck's own tokens live inside `@layer puck-tokens`; this is a plain
(unlayered) rule, which the cascade always ranks above any layered
declaration regardless of selector specificity or source order — no
`!important` needed, and no risk of losing a specificity fight later.

This is the first CSS in this codebase to target Puck's own DOM at all, so
it's worth naming the actual risk being taken and why it's scoped: these
custom-property *names* are Puck's own documented theming surface for this
exact row (their presence, with fallback syntax, in the compiled CSS is
itself the contract — not an inference from behavior), so they're expected
to be stable within a pinned major/minor the way any library's public API
would be. The one place this ADR does still touch something *unexposed* as
a property is the hover-reveal selector for the preview (next section),
which keys off `[data-puck-drawer-item]` — a plain data attribute (Puck's
own drag-testid-style hook, not a hashed CSS-module class), chosen
specifically because it's the more stable of the two real options Puck
exposes on this row. Forking `Drawer`/`DrawerItem` entirely was rejected as
disproportionate: it would mean owning drag-and-drop, keyboard nav and
`dnd-kit` wiring for a picker row, to fix a handful of CSS properties Puck
already lets you set from outside.

### 3. Hover preview: the real block, scaled down, docked at a fixed spot

`BLOCK_PREVIEWS: Record<string, { Component, defaultProps }>` (same
`config.tsx`) exports a live `Component`/`defaultProps` pair per block type.
`overrides.drawerItem` renders `<preview.Component {...preview.defaultProps}
/>` inside a small wrapper carrying `previewRootStyle(tokens)` — the same
theme-CSS-variable wrapper `createPuckConfig`'s `root.render` already applies
inside the canvas, exported standalone (`previewRootStyle`) so the preview
isn't unstyled black-on-white. **A live component, not a pre-rendered
image**: every block is already a plain, SSR-safe React component with a
complete `defaultProps` sitting right in `BLOCK_ENTRIES` — this is the exact
same `<Component {...rest}/>` call `registerBlock` already makes for the
canvas itself (`config.test.tsx` already proves that call is byte-identical
to the block's own default render), so a preview can never drift from what
dragging the entry onto the canvas actually produces. A pre-rendered image
would need its own build/regeneration step per block, per theme, and would
go stale exactly when a block's default render changes — the thing this
approach can't drift on for free.

The reveal itself is CSS-only (`:hover` + `visibility`/`opacity`, gated to
`@media (hover: hover) and (pointer: fine)`, matching Puck's own drawer-item
hover media query) — no hover-state JS. The genuinely new decision is
*where* the preview renders. Verified directly in a running editor
(Playwright against the real dev stack, not assumed): none of the drawer's
real ancestors up to Puck's own root (`_BlocksPlugin`, `_Sidebar--left`,
`_PuckLayout-inner`, `.Puck`) set a `transform`/`filter`/`perspective`/
`contain` — the properties that would otherwise make `position: fixed`'s
containing block something other than the viewport. That confirms `position:
fixed` reliably escapes the drawer's own `overflow-y: auto` clipping, which a
`position: absolute` popover could not (its nearest positioned ancestor is
still inside that clipped scroll container). The preview is docked at a
**static** viewport location (`top: 50%` with `translateY(-50%)`, `left:
24rem` — clearing the widest the left sidebar/plugin-bar assembly measured
while verifying this, ~358px, plus margin) rather than tracked to whichever
row is hovered. Anchoring precisely beside the hovered row would need that
row's on-screen Y at hover time, which only JS (`getBoundingClientRect`) can
supply — the one place here where "simplest mechanism that satisfies the
requirement" means dropping the row-relative anchoring rather than adding a
hover-state machine to get it.

Because the preview is a scaled-down real render (not a shrunk font), the
scale-down is a CSS `transform: scale()` on a fixed-width inner wrapper, not
a smaller `font-size`: a block's own type tokens (`--pf-fontSize-*`) are
root-`rem`-relative (`packages/blocks/src/theme-css.ts`), so shrinking an
ancestor's `font-size` would not rescale them — only a visual transform
shrinks text, spacing and images together.

## Consequences

- Both row copies (`draggableBg`/`draggableFg`) mount the preview's
  `<Component>` — `overrides.drawerItem` has no way to distinguish which
  copy it's rendering for. The inert `draggableBg` copy (`pointer-events:
  none`, `z-index: -1`) never becomes hoverable, so this costs one extra
  mount per block type, not a visible or interactive duplicate. The two
  blocks whose `defaultProps` reference an external placeholder image
  (`Image`, `Gallery` — `placehold.co`) fetch it twice as a result; this is
  a small, one-time network cost (typically deduped by the browser's HTTP
  cache), not scaling with how many times a row is hovered.
- The docked preview's fixed `left: 24rem` is an empirical constant (the
  measured left-sidebar-assembly width), not a token — it isn't wrong until
  Puck's own sidebar width changes, at which point it wants a quick manual
  re-check, the same maintenance shape as `.pf-template-grid`'s breakpoints
  matching `BREAKPOINT_MIN_WIDTH` elsewhere in this codebase.
- No published-site behavior changes: `packages/blocks`, `packages/publish`,
  and every block contract are untouched. `pnpm run ci:containment`'s five
  invariant checks (Astro containment, Puck containment, runtime
  separability, SSR safety, block-contract color literals) all still pass.

## Rejected

**Forking Puck's `Drawer`/`DrawerItem` components** to get full control of
the outer row markup. Rejected as disproportionate to the ask: it would mean
owning drag-and-drop (`@dnd-kit`), keyboard interaction and Puck's own
generated ids for a picker row, to change a handful of CSS properties Puck
already exposes as custom properties for exactly this purpose.

**A JS-managed tooltip** (mouseenter/mouseleave state, `getBoundingClientRect`
positioning, a portal). Would let the preview anchor precisely beside
whichever row is hovered, but reintroduces the hover-state machinery this
slice's own guidance (and this codebase's general preference for the
simplest mechanism that satisfies a requirement) asks to avoid where a
CSS-only mechanism already gets a "roughly what it looks like" preview in
front of the editor. Left as a natural follow-up if a fixed-dock preview
ever proves confusing in practice.

**Shrinking the preview via a smaller ancestor `font-size`** instead of a
`transform: scale()`. Rejected once checked against how blocks actually size
type: `--pf-fontSize-*` tokens are root-`rem`-relative, so an ancestor
`font-size` change does not cascade into them — only a visual transform
shrinks a themed block's text, spacing and images together.
