# The block contract

KAN-1139 (SLICES.md "after milestone 1"): a written, stable-enough description
of what every first-party block already does, so a future third-party author
has something concrete to build against. This document doesn't change any
block's behavior — it names the pattern all 11 first-party blocks (as of
2026-09) already follow, and two of that pattern's rules (SSR-safety, no raw
color) are now enforced by `pnpm run ci:containment`, not just written down.

**This is not the ecosystem opening.** ADR-0011 is still the governing
decision: first-party blocks only. Opening the contract to third-party code
needs an isolation/sandboxing boundary that does not exist yet — this
document is preparation for that day, not a change to today's security
posture. "Stable enough to document" also isn't "frozen" — this contract can
still change before milestone 2's block count settles; no compatibility
guarantee is made yet.

## What a block module exports

One directory under `packages/blocks/src/<type>/`, with a `schema.ts` and a
component file exporting exactly this shape (see `packages/blocks/src/hero/`
for the reference example):

| Export | Shape | Purpose |
|---|---|---|
| `<TYPE>_BLOCK_TYPE` | `string` constant | The block's `type` value stored in every `BlockNode` of this type (ADR-0002) |
| `<TYPE>_BLOCK_VERSION` | `number` constant | Current schema version — bump only when an existing field's *meaning* changes, not when a new optional field is added (see Versioning below) |
| `<Type>PropsSchema` | `z.object({...}).strict()` | The block's own props, validated |
| `<type>DefaultProps` | `<Type>PropsSchema.parse({})`-derived | What a freshly-inserted block of this type starts with |
| `<type>BlockDefinition` | `BlockTypeDefinition<Type Props>` | `{ type, version, propsSchema, defaultProps, migrations }` — registered in `packages/blocks/src/registry.ts`'s `BLOCK_ENTRIES` |
| The component | `(props: <Type>Props & BlockRenderProps) => JSX.Element` | Renders identically in the Puck canvas and the published Astro output (ADR-0004's WYSIWYG guarantee) |

`BlockRenderProps` (`packages/blocks/src/responsive.tsx`) is the one thing
every block accepts beyond its own props: `{ blockId?: string; responsive?:
BlockResponsive; scrollReveal?: boolean }`. Puck doesn't forward any of them
today (no per-breakpoint-override widget in the canvas yet, and scroll-reveal
is deliberately published-output-only — see ADR-0015), so all three must be
optional and a component must render sensibly with none set.

## Props schema rules

- **`.strict()`, always.** An unrecognised field is a validation error, not
  silently dropped or ignored — this is what makes a page document
  byte-identical across export → import → export (R8). Enforced for every
  registered block by `packages/blocks/test/block-contract.test.ts`, which
  iterates the whole registry rather than relying on each block's own test
  file to remember to check it.
- **Every optional field has an explicit `.default(...)`, never a bare
  `.optional()`.** `subheading`, `ctaLabel`, `waitlistEnabled` and every
  other non-required field across the first-party library follow this —
  it's what lets `<type>DefaultProps` exist as a single, always-valid object,
  and what lets a document written before a field existed still parse today
  (see Versioning).
- **Bound every string/array field's size** (`.max(...)`). Unbounded text
  fields are a stored-content-size and canvas-inspector-rendering risk with
  no product upside — every first-party block bounds every string.
- **A field naming another entity is a `string`, resolved server-side —
  never trust a client-supplied numeric/priced value for anything that has a
  real-money or real-capacity consequence.** The Payment block's `amount` and
  the EventSignup block's `capacity` are read from a publish-time snapshot on
  the server (`payment_blocks`/`event_signup_widgets`) precisely so a
  tampered runtime request can never override them — a block's *props* can
  say "charge $25", but the *runtime* endpoint a visitor actually hits never
  takes the amount from that visitor's own request.

## Token-only styling (CLAUDE.md invariant 2, ADR-0002)

Every color, spacing value, corner radius, font size and font family a block
renders comes from `cssVar(group, name)` (`packages/blocks/src/theme-css.ts`)
— never a literal. The five token groups today: `color`, `fontSize`,
`spacing`, `radius`, `fontFamily`. This is what makes a template's
`theme.json` swap the entire look of every page without touching a single
block's props.

**Now mechanically enforced**, not just written down:
`checkNoRawColorsInBlocks` (`tools/checks/src/containment.ts`, run by
`pnpm run ci:containment`) AST-scans every `packages/blocks/src/**/*.tsx` file
for a hex color literal or an `rgb()`/`rgba()`/`hsl()`/`hsla()` call outside a
string that already contains `var(--pf-` (a `cssVar()` result, safe to
compose inside a larger string like a `linear-gradient(...)`). A block that
hardcodes `#4f46e5` fails the build the same way an Astro import outside
`packages/publish` does.

**What this rule does *not* cover, on purpose:** small structural CSS
constants that aren't a themeable design decision — a `1px` border width
(`Button.tsx`), `em`-relative padding ratios (`0.75em 1.5em`, used for every
button/CTA's own padding), an opacity value for an image scrim (`Hero.tsx`'s
`backgroundImage` feature). None of these vary by theme; none of them are
what invariant 2 exists to protect. If a future block finds itself repeating
the same "structural" numeric literal across several places, that's a signal
a new token group may be warranted — raise it as a schema change (see
`docs/adr/0014-free-positioning-layout.md` for the shape a proposal like that
takes), don't just hardcode it wider.

## SSR-safety (ADR-0004, ADR-0007)

A block component may reference `window`, `document`, `navigator`,
`localStorage` or `sessionStorage` only inside a `useEffect`/`useLayoutEffect`
callback. Mechanically enforced today (`checkSsrSafety`,
`tools/checks/src/ssr-safety.ts`, AST-walked so a comment or string literal
mentioning "window" is never a false positive) — this predates this card, and
is unchanged by it; listed here so the whole contract lives in one place.

## Scroll-triggered reveal (ADR-0015)

`scrollReveal` is a third, optional `BlockRenderProps` field, sibling to
`blockId`/`responsive`: an optional `boolean`, absent/`undefined` read as
`false` everywhere it matters (not schema-defaulted, unlike `responsive` —
see ADR-0015 for why). A block opts in
by spreading `scrollRevealAttrs(scrollReveal)` (`packages/blocks/src/
scroll-reveal.tsx`) onto its own root element — one attribute
(`data-pf-reveal`), no wrapper, no per-block CSS. See ADR-0015 for the full
design: why this is a page-level shared vanilla-JS observer rather than a
per-block `useEffect`/island, how it stays SSR-safe and
`prefers-reduced-motion`-correct with zero JS dependency for content to
exist, and why (like `responsive`/`position`) it never applies inside the
Puck canvas.

## No Puck context in a block (ADR-0004)

A block module (`packages/blocks/src/**`) never imports `@puckeditor/*`.
Mechanically enforced today (`checkPuckContainment`,
`tools/checks/src/containment.ts`) — also predates this card, listed here for
the same reason.

## Versioning and migration (ADR-0002 §12)

`<type>BlockDefinition.version` is the schema version a freshly-created block
of this type is stamped with. `migrations` is a `Record<number, (props) =>
props>` keyed by the version being migrated *from* — `migrations[3]` takes
v3 props and returns v4 props. `migrateBlockProps` (`packages/schema/src/
registry.ts`) walks the chain from a stored block's `schemaVersion` to the
definition's current `version`, throwing `MigrationGapError` rather than
guessing if a step is missing.

**Adding a new optional field with its own `.default(...)` does not need a
version bump or a migration function.** Every existing stored block (still at
the old version) already parses correctly against the new schema — zod fills
the missing key in on read. This is how `Hero.backgroundImage`, `ThemeTokens.
fontFamily` and `BlockNode.responsive` were all added. A version bump is only
needed when an *existing* field's meaning changes in a way `.default()`
cannot paper over (a renamed field, a changed unit, a type change) — none of
the 11 first-party blocks have needed one yet.

## What this document deliberately does not do

- It does not add a plugin/loading mechanism for third-party code. That is
  the isolation-boundary work ADR-0011 named and explicitly deferred.
- It does not freeze the contract. A genuinely new need (KAN-1129's
  free-positioning layout, for instance) can still change the shape here —
  a real ADR is still how that happens, the same as before this document
  existed.
- It does not retroactively re-litigate any existing block's props shape.
  This is a description of the pattern as it stands, not a redesign.
