# ADR-0015: Scroll-triggered reveal, an opt-in per-block rendering capability

- **Status**: Accepted
- **Date**: 2026-09-05
- **Fork**: KAN-1152 (thread 2, split from KAN-1128 alongside KAN-1129)

## Context

KAN-1152 asks for a cross-cutting "reveal on scroll" effect, and explicitly
asks for it to be scoped with its own small design note before being built —
the same discipline ADR-0014 applied to KAN-1129's free-positioning layout.
This is that note. It is intentionally not a full ADR-0014-sized document:
the schema surface added here is one optional boolean, not a new layout mode
with conditional validation, but it still touches `BlockNodeSchema` (a
binding, documented shape) and the render contract every block follows
(`docs/BLOCK_CONTRACT.md`), so it gets written down before implementation
rather than folded silently into a PR.

Two existing precedents already establish the shape of "a cross-cutting
rendering concern every block can opt into," and both matter here:

- `BlockRenderProps` / `ResponsiveStyle` (`packages/blocks/src/responsive.tsx`)
  — a block accepts `{ blockId?, responsive? }` beyond its own props, and
  renders a sibling `<style>` tag scoped to its own `data-pf-block-id`. Puck's
  canvas deliberately never forwards `blockId`/`responsive`
  (`packages/puck-adapter/src/config.tsx`'s `registerBlock` only ever
  forwards `block.props`, never the block's sibling schema fields), so a
  block renders its plain base styling inside the editor and its "live"
  styling only in the published output — no branching inside the block
  itself, just an absent prop.
- `FreePositionStyle` / `freePositionBaseStyle` (`packages/blocks/src/
  free-position.tsx`, ADR-0014) — a page-level concern, applied by
  `packages/publish/src/page-template.ts` wrapping each root block's already-
  rendered output, specifically *so that* adding it never touched any of the
  ~30 existing block components.

Scroll-reveal has to answer the same five questions ADR-0014 answered for
positioning, and the answers differ from both precedents in one important,
newly-discovered way (see "Rejected" below): **it cannot be implemented as a
per-block React `useEffect` at all**, because Astro's static publish pipeline
only hydrates a component that is *statically* imported with a `client:*`
directive on that exact JSX tag (`page-template.ts`'s own comment:
`blockComponents[block.type]` is a runtime lookup with "no such static import
to point at," which is why Form/Booking/EventSignup/Payment are each
individually imported and special-cased rather than looked up dynamically).
Making scroll-reveal a `useEffect`-driven per-block island would require
doing that for every block type that might opt in — the opposite of "a
generic wrapper any block can use," and it would pay a React-hydration cost
per revealed block instance, against ADR-0007's "static blocks ship 0 KB"
budget.

## Decision

**One optional field, one shared vanilla-JS observer, zero React runtime
cost per block.**

### 1. Where the capability lives

- `BlockNodeSchema` (`packages/schema/src/block.ts`) gains `scrollReveal:
  z.boolean().optional()` — schema-level, sibling to `responsive` and
  `position`, not a per-block-type prop. Shaped like `position`
  (`.optional()`), not like `responsive` (`.default({})`): `responsive`'s
  own default shipped back when every stored `BlockNode` fixture in the
  codebase still needed updating for it anyway, but by now dozens of
  fixtures across `e2e/`, `packages/db`, and elsewhere construct a
  `BlockNode` without ever mentioning `scrollReveal` — confirmed by actually
  trying `.default(false)` first and running `pnpm --filter @prefab/e2e run
  typecheck`, which turned up ~20 now-broken call sites (every one missing
  a newly-*required* field). `.optional()` is what keeps every one of those
  compiling and behaving unchanged, at the cost of reading it as
  `scrollReveal === true` (never a bare truthy check, and never `?? false`
  defaulted deep in schema) at each of the few call sites that care. Needs
  neither a version bump nor a migration either way — it's a new optional
  field, full stop (`docs/BLOCK_CONTRACT.md`'s versioning rule).
- `BlockRenderProps` (`packages/blocks/src/responsive.tsx`) gains
  `scrollReveal?: boolean`, so `page-template.ts` passes it down exactly the
  way it already passes `blockId`/`responsive`.
- A block opts in with **one spread of attributes onto its own root
  element** — `scrollRevealAttrs(scrollReveal)` (`packages/blocks/src/
  scroll-reveal.tsx`), which returns `{ "data-pf-reveal": "" }` or `{}`. No
  wrapper tag, no new child element, no per-block CSS (unlike
  `ResponsiveStyle`, there is nothing block-specific to compute — the
  selector is the single global attribute `[data-pf-reveal]`, not a
  per-block id — so there is no `<ScrollRevealStyle blockId=... />` a block
  needs to render itself). Adopting this in an existing block is a one-line
  destructure plus a one-line attribute spread — demonstrated on `Hero.tsx`
  as the reference block, the same block `ResponsiveStyle` was first wired
  into.
- The CSS and the observer script themselves are **page-level, not
  block-level** — `ScrollRevealAssets` (same file), rendered once by
  `page-template.ts`, gated on whether any block on the page actually has
  `scrollReveal: true` (`pageNeedsScrollRevealAssets(page.blocks)`). A page
  with nothing opted in emits nothing extra at all, mirroring
  `ResponsiveStyle`/`FreePositionStyle`'s "renders nothing when there's
  nothing to do."

### 2. SSR-safety mechanism

No `useEffect` in any block component is needed, because no block component
does any browser-API work at all for this feature. The only client-side code
is `SCROLL_REVEAL_BOOTSTRAP_SCRIPT`, a plain string constant holding vanilla
JS, emitted as a literal `<script>` tag by `page-template.ts` (an Astro
template, allowed to reach into browser APIs directly in a real
`<script>` — it never executes during SSR; the Astro/Node build process
treats it as opaque text, the browser is the only thing that ever runs it).
This sidesteps `tools/checks/src/ssr-safety.ts` entirely rather than merely
satisfying it: that checker AST-scans **block component TypeScript source**
for a bare `window`/`document`/etc. identifier outside a `useEffect` callback
— a string constant containing the text `"window"` inside `packages/blocks/
src/scroll-reveal.tsx` is exactly the "string literal mentioning window" case
the checker's own comment says is deliberately not a false positive.

Content is never gated on JS for existence or readability:

- Default state (no `pf-reveal-hidden` class present — true for every
  element until the script explicitly adds it): `[data-pf-reveal]` renders
  at `opacity: 1`, no transform. A no-JS visitor, a crawler, and
  `tools/checks/src/fidelity.ts`'s raw-HTML/screenshot comparison all see
  the block's real content, unconditionally.
- Only the script — which runs exclusively in a browser, feature-detects
  `IntersectionObserver` before doing anything (`if (!('IntersectionObserver'
  in window)) return;`, leaving content visible on an old/no-JS-API browser
  too) — ever adds the `pf-reveal-hidden` class that the CSS then animates
  away from as the element scrolls into view.

### 3. `prefers-reduced-motion` handling

Handled twice, deliberately redundantly, because the card's own requirement
is strict (immediate, no partial transparency, never gated on a "skip the
animation but still hide first" half-measure):

- **CSS override, unconditional**: `@media (prefers-reduced-motion: reduce)`
  forces `[data-pf-reveal].pf-reveal-hidden { opacity: 1 !important;
  transform: none !important; transition: none !important; }`. This holds
  regardless of what the script does — even if the script's own check below
  were ever wrong, the browser's own media query still wins.
- **Script-side short-circuit**: before doing anything else, the script
  checks `window.matchMedia("(prefers-reduced-motion: reduce)").matches`; if
  true, it never adds `pf-reveal-hidden` to any element and never creates an
  observer at all — so a reduced-motion visitor never sees so much as a
  transition-less instant class flip, only the content, immediately, exactly
  as if `scrollReveal` were never set.

### 4. Where it applies

**Published/exported output only — not the Puck editor canvas.** Concretely:

- `page-template.ts` (`SITE_PAGE_ASTRO`) is the one render path this feature
  touches, and it is shared **verbatim** by all three surfaces that ever
  build a site: the hosted publish pipeline (`build-worker.ts` →
  `workspace.ts`, which writes `SITE_PAGE_ASTRO` into the build workspace),
  self-host/tier-(b) export (`exportBundle` → the same `buildSiteBundle` →
  the same `workspace.ts`), and the Astro-eject/tier-(c) output
  (`eject.ts`, which imports and writes the identical `SITE_PAGE_ASTRO`
  string, and separately `cp`'s the whole of `packages/blocks/src` —
  including the new `scroll-reveal.tsx` — into the ejected project
  verbatim). Traced directly rather than assumed, per KAN-1129's own
  precedent for this exact question. `eject.ts`'s vendored `@prefab/schema`
  type shim (`prefabSchemaShimTypesSource`'s `BlockNode` interface) also
  gains `scrollReveal?: boolean` so the ejected project's own type-check of
  the copied block sources stays accurate, matching how `position` was
  added there.
- Puck's canvas (`packages/puck-adapter`) needs **no change to make this
  inert** — it already doesn't forward `blockId`/`responsive`/`position` into
  a rendered block's props (`config.tsx`'s `registerBlock` forwards only
  `block.props`), and `scrollReveal` is a sibling schema field of exactly
  that same kind, so it is never present on a canvas-rendered block either.
  The one real change needed in `packages/puck-adapter` is in
  `convert.ts`'s `componentDataToBlock`, which must carry a block's existing
  `scrollReveal` value forward across an unrelated canvas edit — the same
  reason `responsive` and `position` are carried forward there today: a
  canvas edit that doesn't touch this field must not silently erase it.
  This is round-trip preservation, not canvas rendering, and doesn't
  contradict "inert inside Puck."
- This is the same call ADR-0014 and `ResponsiveStyle` both already made,
  for the same reason the card names: a block fading in and out while
  someone is actively dragging/editing it is bad editing UX, not a neutral
  gap. It's recorded here explicitly rather than left implicit.

### 5. Opt-in granularity

Per-block boolean flag (`scrollReveal`), absent/`undefined` treated as
`false` everywhere it's read. Nothing about any existing document changes:
every stored page (none of which have this key) parses with the key simply
missing, and `pageNeedsScrollRevealAssets` returns `false` for every page
that hasn't touched the field, so **zero bytes of new CSS or JS ship on any
existing site** until something explicitly sets `scrollReveal: true` on a
block. Turning it on for any of the 8 original templates, or for
`wellness-studio`, is out of this slice's scope — that's thread (1)'s
craft-pass follow-up (or a later card) to decide, per-template, not a
capability-building decision.

## Consequences

- No React hydration cost is added to any block, revealed or not — the only
  new client bytes on a page that uses this are one shared `<style>` and one
  shared `<script>` (a few hundred bytes each), present exactly once no
  matter how many blocks on that page opt in. `pnpm run ci:budgets` should
  see no regression on any existing template (none opt in).
- A revealed element briefly renders in its final, visible state before the
  script runs (there is no pre-hidden CSS state without a script-added
  class) — for a motion-allowed visitor whose JS loads, this can show a
  faint flash-to-visible-then-hide before the reveal transition starts, the
  same trade-off most reveal-on-scroll libraries (e.g. AOS.js) make in
  exchange for "real content, never gated on JS." This is deliberate, not
  overlooked: the alternative (default-hidden CSS) is exactly the failure
  mode the card rules out.
- Because the observer script is generic (`[data-pf-reveal]`, not per-block
  scoped), it needs no `blockId` and does no per-block CSS generation — a
  meaningfully smaller mechanism than `ResponsiveStyle`/`FreePositionStyle`,
  since there is nothing block-specific to parameterize (every reveal looks
  the same: fade + slight upward translate). If a future need calls for
  per-block reveal variants (slide direction, delay, distance), that's a
  schema/contract change to make then — `scrollReveal` staying a plain
  boolean today is a deliberate "smallest thing that satisfies this slice,"
  not a ceiling.

## Rejected

**Per-block React `useEffect` + `client:visible` island**, mirroring how a
block might naively be expected to "just observe its own ref." Rejected
because Astro's `client:*` hydration directive requires a statically-known
import on the exact rendered JSX tag (`page-template.ts`'s own documented
constraint — this is *why* Form/Booking/EventSignup/Payment are each
individually imported and branched rather than resolved through
`blockComponents[block.type]`). Making scroll-reveal work this way for "any
block" would mean hard-coding every block type that might ever want reveal
into `page-template.ts` by name, the opposite of a generic capability, and
would hydrate a full React island per revealed block instance rather than
sharing one small observer — a real cost against R3's LCP budget for pages
with several revealed blocks.

**Default-hidden CSS** (`[data-pf-reveal] { opacity: 0 }` unconditionally,
with only the *animation* skipped under reduced motion or no-JS). This is
exactly the failure mode the card calls out by name — permanently invisible
content for a no-JS visitor, a crawler, and the fidelity harness alike — and
is rejected outright, not just deprioritized.

**A `variant`/`delay`/`distance` config object on `scrollReveal` from the
start** (matching `ResponsiveOverrideSchema`'s "bounded fields, not a style
bag" shape). Deferred, not rejected on principle: this slice's ask is "build
the capability," and a single boolean is the smallest schema surface that
satisfies "opt-in per block, off by default." Widening it is a natural,
low-cost follow-up once a real per-template need names which knobs actually
matter, the same way `ResponsiveOverrideSchema` grew from real need rather
than upfront guessing.
