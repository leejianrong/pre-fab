# ADR-0004: React blocks, Puck for the canvas, framework behind the schema

- **Status**: Accepted
- **Date**: 2026-08-27
- **Fork**: FORK-4

## Context

The block framework is not an internal preference. It is:

- what a customer inherits when they eject (ADR-0010),
- what third parties must write against if a block ecosystem ever opens
  (ADR-0011),
- and the thing that must render identically in the editor canvas and in the
  published output, or WYSIWYG is a lie.

Svelte with Vite was proposed. Three questions were being collapsed into one, and
only the first carries weight: the **block** framework (very hard to reverse), the
**editor chrome** framework (trivially reversible, purely internal), and the
**backend** language (a separate axis, ADR-0013).

Facts gathered:

| Fact | Consequence |
|---|---|
| Puck: 13.2k stars, 2,104 commits, MIT, stores pages as a JSON tree keyed to component props | Mature, and its data model closely matches ADR-0002 |
| Svaro, the closest Svelte analogue, is explicitly Puck-inspired: 23 stars, marked work-in-progress | No Svelte equivalent exists |
| svelte-visual-builder: 30 stars, MIT, properly packaged | Closest Svelte option; still not a Puck |
| Svelte island runtime ~1–10 KB vs React ~45 KB gzipped | Real advantage, quantified below |

On bundle size specifically: because ADR-0007 chose static-first with islands,
static blocks — hero, text, image, gallery — ship **0 KB in either framework**.
Only interactive islands pay the runtime. The real delta is roughly 40 KB gzipped
on pages containing at least one interactive block, around 0.1–0.2 s on 4G.
Against R3's 1.5 s p75 LCP target that is meaningful but not decisive, and images
and fonts dominate LCP on marketing sites by a wide margin.

## Decision

**React for blocks. Puck for the editor canvas in milestone 1, behind our own
document schema.**

The framework is kept **out of the data**. The document format is
framework-agnostic JSON (ADR-0002), so the framework is a replaceable rendering
layer. Puck is adapted to our schema, not adopted as our schema. Switching later
costs a renderer rewrite — expensive — but not a data migration and not a
customer-visible break.

Scoring, weighted by reversibility:

| Criterion | Winner |
|---|---|
| Editor build cost (6–10 weeks) | React |
| Value of an eject to the customer (hireability) | React |
| Third-party block supply | React |
| Agent-authored block quality | React |
| Hiring | React |
| Island bundle size | Svelte |
| Authoring ergonomics | Svelte |

React wins the irreversible criteria; Svelte wins two, and its largest win is
substantially designed away by ADR-0007.

On agent-authored block quality: this is product-relevant rather than a developer
convenience. Svelte 5's runes changed the idioms recently enough that models
frequently emit Svelte 4 syntax; React's component idiom is the most heavily
represented in training data. For a product where agents may generate custom
blocks, generation quality is a product input.

## Consequences

- Milestone 1 avoids 6–10 weeks of canvas work, which under the scope in PLAN.md
  is the difference between a three-month and a five-month first release.
- We inherit Puck's constraints and its release cadence. Mitigated by the schema
  boundary: Puck is a dependency of the editor package only, and the renderer and
  runtime do not import it.
- Interactive-island pages carry ~40 KB gz more than they would with Svelte. R3
  must therefore be defended on image discipline, font loading, and keeping the
  island count per page low.
- If Puck's model fights ours during slice 1, the fallback is React plus a
  hand-built canvas — the block investment is preserved either way. This is why
  slice 1 exists.

## Rejected

**Svelte plus a hand-built canvas.** Adds 6–10 weeks to a scope-constrained
milestone 1 and trades the ecosystem advantages for ~40 KB. Legitimate only on
founder-velocity grounds, which were considered and declined.

**Framework-agnostic blocks via Web Components.** Tempting, because it decouples
the export contract from any framework. But declarative shadow DOM SSR is still
rough, styling across shadow boundaries fights the `theme.json` token system that
makes templates swappable, form participation is fiddly, and the canvas would
still have to be built. Recorded here explicitly so it is not re-opened.
