# Design audit — templates + editor, September 2026

KAN-1203. A critique of the 9 shipped templates and the editor's key
screens against named frameworks, not vibes: an 8pt/4pt spacing grid and
vertical rhythm, a type scale with sane line-height ratios, WCAG 2.1 AA
contrast and touch-target guidelines, and Material Design 3 (the standard
`apps/editor/src/ui/` already follows for EPIC-151). This is a research
deliverable, not a code change — it exists to inform KAN-1204/1206/1207 and
flag anything they miss.

**Method:** rendered and read all 9 templates at 375/768/1440px via
`pnpm run design:screenshots` (KAN-1202's tool, unmodified), plus the
editor's template picker and site-editor canvas against a live `make up`
stack. Screenshots aren't committed by that tool (gitignored,
`tools/design-review/output/`); the handful this doc cites as evidence are
copied into `docs/screenshots/design-audit-2026-09/`. Beyond screenshots,
every finding below is cross-checked against the actual token values in
`packages/templates/templates/*/theme.json`, the block source in
`packages/blocks/src/*.tsx`, and (for the mobile-overflow finding) an ad
hoc Playwright script driven straight through `buildSiteBundle` — the same
one-off approach the card suggested, not committed, since it was a single
diagnostic run.

---

## 1. Spacing: the token scale itself is fine; what sits on top of it isn't

All 9 templates share the same `spacing` scale for `xs`/`sm`/`element`/`lg`
(8px/12px/16px/32px); only `section` varies:

| Template | xs | sm | element | lg | section |
|---|---|---|---|---|---|
| agency | 8px | 12px | 16px | 32px | 88px |
| cafe | 8px | 12px | 16px | 32px | 80px |
| consultant | 8px | 12px | 16px | 32px | 80px |
| event | 8px | 12px | 16px | 32px | 80px |
| fitness-coach | 8px | 12px | 16px | 32px | 80px |
| personal-brand | 8px | 12px | 16px | 32px | 96px |
| photographer | 8px | 12px | 16px | 32px | 80px |
| tutor | 8px | 12px | 16px | 32px | 80px |
| wellness-studio | 8px | 12px | 16px | 32px | 96px |

Every one of these values, across all 9 templates, is a multiple of 4 —
**the 8pt/4pt grid holds**, this is not a gap. `radius` intentionally
varies per template (0.25rem–1.25rem, plus `full`), which is correct:
templates are editorial/per-template by design, not MD3-bound.

**The real gap is a missing middle rung.** The scale jumps from `lg` (32px)
straight to `section` (80–96px) with nothing between. `DEFAULT_THEME_TOKENS`
in `packages/schema/src/theme.ts` has the same shape. Every standalone
block that isn't `Hero` (which is the only block that uses `section`) has
no spacing option between "32px" and "80–96px" — so a block author (or, in
practice, the template's own JSON) is stuck choosing between a cramped
12px/32px gap or a cavernous 80px+ one. This is visible in every
multi-section template screenshot: see
`docs/screenshots/design-audit-2026-09/agency-desktop-1440-rhythm.png` —
the gap between the "Selected work" `Heading` and its `CardGrid` below is
12px (`Heading`'s own `padding: sm 0`), while the gap between `Hero`'s CTA
button and the next `Heading` above it is ~130px (`Hero`'s own `section`
padding). Same page, same visual "section break" concept, off by roughly
10×.

**A second, more consequential gap: no page-level horizontal gutter
token.** There is no `<body>` padding, no content-wrapper `max-width`,
nothing in `packages/publish/src/page-template.ts` establishing a page
margin. What every screenshot's left edge actually reflects is the
browser's own default UA `<body>` margin (8px in Chromium/Playwright) —
not a design decision, not theme-controlled, not consistent. On top of
that incidental 8px, `Nav`, `Hero`, `Footer`, `ContactDetails`, and
`Testimonial`'s card each add their *own* `spacing.element` (16px)
horizontal padding — landing their content at ~24px from the edge — while
`Heading` (standalone), `CardGrid`, `Gallery`, `RichText`, and `Faq` add
none, landing at the incidental 8px. The result is a page where the left
edge of text zig-zags between 8px and 24px block to block, visible in
every template's screenshots once you look for it (compare "Northwind
Digital" nav-brand indent vs. "Services"/"Selected work" heading indent in
`agency-desktop-1440-rhythm.png` — the headings sit ~16px further left
than the nav brand and hero heading above them).

Confirmed via direct measurement (Playwright `getBoundingClientRect`, 375px
viewport, `consultant` template): `CardGrid`'s outer `div` starts at
`left=8`; its `h3` title starts at `left=24` (8 + the card's own 16px
padding). Same numbers, independently, on every other template checked.

---

## 2. Type scale + line-height: the scale is workable, line-height doesn't exist

`fontSize` tokens are **identical across all 9 templates** (this is good —
a real shared scale, not per-template drift):

| Token | Value | px (assuming 16px root) |
|---|---|---|
| xs | 0.75rem | 12px |
| sm | 0.9375rem | 15px |
| body | 1.125rem | 18px |
| lg | 1.25rem | 20px |
| heading | clamp(2rem, 4vw, 3.5rem) | 32–56px |
| display | clamp(2.5rem, 6vw, 4.5rem) | 40–72px |

Step ratios are irregular (sm/xs 1.25, body/sm 1.2, lg/body 1.11, then a
large jump into the `clamp()` steps) — not a named modular scale, but not
wrong either; I wouldn't block anything on this alone.

**The real finding: there is no `lineHeight` token group, anywhere.**
`ThemeTokensSchema` (`packages/schema/src/theme.ts`) defines exactly five
groups — `color`, `fontSize`, `spacing`, `radius`, `fontFamily` — confirmed
both in the schema and in `docs/BLOCK_CONTRACT.md`'s own "five token groups
today" line. A `grep -rn "line-height\|lineHeight" packages/blocks/src/`
returns **zero matches** across all ~30 block components. Every block that
renders text (`RichText`, `Heading`, `CardGrid`, `Testimonial`, `Faq`,
`ContactDetails`, `PostDetail`, `PostList`) falls through to the browser's
default `line-height: normal`.

Measured directly (ad hoc long-form article page, built through the same
`buildSiteBundle` path the committed tool uses, on the `consultant`
template's own theme): a `.pf-richtext-paragraph`'s computed
`line-height` is the literal string `"normal"` at `font-size: 18px`. For a
system-ui-family stack, `normal` resolves to roughly **1.15–1.2×** —
against the card's own explicit target of **1.4–1.6×** for body text. This
is visually obvious in the rendered screenshot
(`docs/screenshots/design-audit-2026-09/longtext-desktop-1440-measure.png`)
— paragraph lines read as visibly cramped, closer to a tightly-set caption
than body prose.

**Measure (characters per line) is uncapped and gets extreme on desktop.**
Same ad hoc render, three viewports:

| Viewport | Paragraph width | Approx. characters/line |
|---|---|---|
| 375px (mobile) | 359px | ~38 |
| 768px (tablet) | 752px | ~80 |
| 1440px (desktop) | 1424px | **~152** |

Recommended measure for body text is ~45–75 characters/line. Mobile is
close to reasonable (a bit tight); tablet is mildly over; desktop is
**more than double** the upper bound, because `RichText` and `PostDetail`
apply no `max-width` — the paragraph is exactly as wide as whatever
container it's dropped into, and nothing in the page constrains that
container's width on wide viewports either (see the missing page-gutter
finding above — the two compound: no gutter *and* no measure cap means a
paragraph on a 1440px viewport runs edge-to-edge, full-width, at ~152
characters/line). See the same screenshot above.

---

## 3. WCAG 2.1 AA: token contrast is solid; the gaps are all in what CI can't see

**Token-pair contrast is good across the board.** Computed WCAG relative-
luminance contrast ratios for every template's `color` tokens (lower is
worse; AA requires ≥4.5:1 for normal text):

| Template | fg/bg | surface-fg/surface | accent-fg/accent | muted-fg/bg |
|---|---|---|---|---|
| agency | 16.5 | 14.9 | 7.1 | 10.2 |
| cafe | 12.5 | 11.2 | 6.2 | 8.3 |
| consultant | 17.9 | 17.1 | 6.3 | 7.6 |
| event | 14.5 | 13.0 | 7.3 | 7.9 |
| fitness-coach | 17.5 | 15.8 | 5.2 | 13.1 |
| personal-brand | 16.4 | 14.8 | 16.4 | 9.6 |
| photographer | 18.0 | 16.2 | 9.4 | 13.3 |
| tutor | 15.8 | 14.3 | 6.1 | 8.5 |
| wellness-studio | 13.1 | 12.0 | **5.0** | 6.5 |

Lowest across all 9 templates and all four pairings: **5.0:1**
(wellness-studio, `accent-foreground`/`accent`) — comfortably above the
4.5:1 AA floor for normal text. No template's static token pairs fail AA.
This part of invariant 2 (tokens, not raw values) is doing real work here:
because every color is a token, this whole table was computable from
`theme.json` alone, and it's clean.

**What `ci:budgets` actually covers, precisely (I read
`tools/checks/src/budgets.ts` and the installed `axe-core` package
directly rather than assuming):**

- `classifyBlockingAxeViolations` (line 69) blocks the build on any
  `impact === "critical"` violation **or** any violation with
  `id === "color-contrast"`, regardless of impact — so template contrast
  genuinely is CI-gated, not just informally checked. Good, and worth
  confirming rather than assuming.
- It only runs against **templates** (`checkTemplateBudget`/
  `checkAllTemplateBudgets`) via a static Astro build. **The editor app has
  zero axe-core coverage anywhere in CI** — grepping `apps/editor/` and
  `tools/checks/src/*.ts` for `axe` outside `budgets.ts` returns nothing.
  The brand-new MD3 kit (EPIC-151) has never been run through an
  accessibility checker.
- `axe.run()` is called with no `runOnly`/`rules` options, i.e. axe-core's
  own default rule set. I checked the actual rule registry of the pinned
  version (`axe-core@4.13.0`, `tools/checks/package.json`):
  `target-size` — WCAG 2.2 SC 2.5.8, tags `["cat.sensory-and-visual-cues",
  "wcag22aa", "wcag258"]` — is present in the package but ships with
  **`enabled: false`**, and nothing in `budgets.ts` turns it on. Touch-
  target size is **not** checked by CI today, for templates or anything
  else, despite the dependency already being available to check it.
- The `Hero` block's `hasImage` variant renders CTA/heading text over a
  55%-opacity color scrim on top of an arbitrary uploaded photo
  (`Hero.tsx`: `background: cssVar("color","accent"), opacity: 0.55`).
  axe-core's `color-contrast` rule generally can't compute a reliable
  ratio against a `background-image` and marks such nodes "incomplete"
  (needs manual review) rather than pass/fail — meaning a customer photo
  that happens to render lighter than expected under the scrim could
  produce genuinely illegible hero text with **zero CI signal**, even
  though `color-contrast` is otherwise correctly gated. This is a real,
  content-dependent risk the token table above can't capture because it's
  static-analysis-shaped and this failure mode isn't.

**Touch targets: not covered by CI, and there's a real instance of the gap
found by direct inspection.** `Nav.tsx`'s and `Footer.tsx`'s `<a>` link
styles (`linkStyle`) set only `color`, `font-size`, `text-decoration` — no
padding. Computed tap-target height ≈ `line-height: normal` at
`font-size: sm` (15px) ≈ 17–18px CSS px. That's under **both** WCAG 2.2's
SC 2.5.8 minimum (24×24 CSS px — note: this is a WCAG **2.2** AA criterion,
not 2.1; WCAG 2.1's own target-size criterion, 2.5.5, is **AAA**, 44×44)
**and** the common mobile guideline of 44–48px (Apple HIG / Material 3's
48dp touch target). `Button.tsx`, by contrast, is fine: `0.75em 1.5em`
padding at `fontSize.body` (18px) works out to roughly 47–48px tall,
clearing every guideline. The gap is specifically in the plain-text nav/
footer links, not buttons generally.

---

## 4. Material Design 3: templates are intentionally out of scope; the editor's own gap is bigger than the header

Per CLAUDE.md and the card's own framing, templates are deliberately
editorial/per-template, not MD3-bound — I'm not treating "the cafe
template doesn't use MD3 elevation tokens" as a finding. What I checked
instead: does the editor app — MD3's actual reference surface
(`apps/editor/src/ui/`, EPIC-151) — actually cover the editor end-to-end?

**Every editor screen except the Puck canvas itself imports the MD3 kit.**
`LoginScreen`, `SignupScreen`, `SitePicker`, `TemplateGallery`,
`OnboardingWizard`, `ThemeEditor`, `BlogPanel`, `DomainsPanel`,
`SubmissionsPanel` all import from `./ui/index.js` (`Card`, `FilledButton`,
`TextField`, etc.) — confirmed by grep, not spot-check. Good, and
consistent with the CLAUDE.md status note that EPIC-151 shipped.

**The Puck canvas itself is the real gap, and it's bigger than "the block
picker needs icons."** `apps/editor/src/main.tsx` imports Puck's own
stock stylesheet globally: `import "@puckeditor/core/puck.css"`. KAN-1205
(already shipped, `45b491a`) suppressed only Puck's own **header** —
its commit message says so explicitly: *"Puck ships its own header
chrome — dark-leaning, styled from its own CSS namespace, unrelated to
this app's `--md-sys-color-*` tokens... Suppressing it entirely leaves
pre-fab's own TopAppBar... as the only chrome above the canvas."* Nothing
in that change, or anywhere else in the repo, restyles Puck's own
component list (the block picker), field/properties panel, or drag
handles. Visible directly in
`docs/screenshots/design-audit-2026-09/editor-canvas-puck-chrome.png`: the
top app bar (pill buttons, MD3 type, correct elevation) sits directly
above a left-hand block list that's plain bordered white rectangles with a
generic drag-handle glyph — no MD3 corner radius, no state layer, a
visibly different type treatment from the chrome one inch above it. This
matters specifically for KAN-1207 (see verdict below): the surface that
card is about to add icons and hover-previews to is Puck's own,
unstyled-by-pre-fab list markup, not an MD3 component.

---

## 5. The "4 templates overflow at 375px" finding: root cause, not just confirmation

The card flagged this as already-known (consultant, cafe, tutor,
wellness-studio render wider than 375px on mobile, confirmed real). I
traced it to a specific, shared cause rather than re-describing the
symptom.

Measured overflow (`document.documentElement.scrollWidth -
clientWidth`, 375px viewport, real `buildSiteBundle` output):

| Template | Overflow |
|---|---|
| consultant | 18px |
| tutor | 38px |
| cafe | 2px |
| wellness-studio | 30px |
| agency, event, fitness-coach, personal-brand, photographer | 0px |

**Every overflowing element is inside `CardGrid`, specifically its `h3`
title.** Walking the DOM for elements where `scrollWidth > own rendered
width` (not just position, since overflowing inline content doesn't move
its own box) turns up things like:

```
h3.pf-cardgrid-title (block=cardgrid) left=149 right=226 width=77
  scrollWidth=112 selfOverflows=true text="Fractional COO"
```

`CardGrid` (`packages/blocks/src/cardgrid/CardGrid.tsx`) hard-codes
`gridTemplateColumns: repeat(${columns}, minmax(0,1fr))`, and **every one
of the 9 templates sets `columns: 3`** with **no responsive override**
(`"responsive": {}` on every single block in every template's
`pages/home.json` — checked, not assumed). At 375px, after the incidental
8px UA body margin, 3 columns with 16px gaps and 16px card padding leave
**~77px of usable width per card**. `h3`'s default bold weight at
`fontSize.lg` (20px) makes almost any single English word 8+ characters
long (`Mathematics`, `Fractional`, `Restorative`, `Breathwork`) wider than
77px — and neither `CardGrid`'s title nor body text sets
`overflow-wrap`/`word-break`, so an unbreakable word simply overflows its
box rather than wrapping.

This is why exactly 4 of 9 templates show it: it's **entirely a function
of each template's own card-title copy**, not a per-template layout
choice. `agency`'s card titles ("Product design", "Web development",
"Brand identity") happen to be short/multi-word enough to wrap under 77px;
`tutor`'s ("Mathematics") isn't. Every template using `CardGrid` (8 of 9 —
all but `photographer`) is equally exposed; the other 4 simply haven't hit
it yet. A customer renaming a card title in the editor tomorrow could
introduce this bug into any of the "clean" 5 templates with zero code
change on pre-fab's part.

---

## Prioritized gap list

1. **`CardGrid`/`Gallery` mobile overflow is a component defect, not a
   per-template content problem** (§5). Highest priority — it's a live,
   customer-triggerable bug affecting 8/9 templates' shared component, not
   cosmetic.
2. **No `lineHeight` token group; body text renders at ~1.15–1.2× against
   a stated 1.4–1.6× target** (§2). Second priority — affects every block
   on every template, cheap to fix once (one schema field + block
   wiring), and the schema/contract doc already describes exactly this
   growth path ("if a future block finds itself repeating the same
   structural numeric literal... raise it as a schema change").
3. **No measure cap on `RichText`/`PostDetail`; desktop lines run to
   ~152 characters** (§2). Same area of the codebase as #2, likely one
   PR together.
4. **Touch-target size is unchecked by CI (a real, disabled `axe-core`
   rule) and `Nav`/`Footer` links measurably fail it** (§3). Concrete,
   narrow fix (two files) plus a CI config change.
5. **No page-level horizontal gutter token; block-to-block left-edge
   misalignment and a missing "medium" spacing rung between 32px and
   80–96px** (§1). Lower priority than 1–4 — a genuine rhythm/polish issue,
   visible but not broken.
6. **Editor: Puck's own canvas chrome (block list, field panel, drag
   handles) is unstyled by the MD3 kit beyond the header KAN-1205 already
   fixed** (§4). Relevant context for scheduling KAN-1207, not urgent on
   its own.
7. **Editor UI has zero automated accessibility coverage** (§3). Lower
   urgency than the template-side gaps since nothing here is *known*
   broken yet, but it's a real blind spot given EPIC-151 shipped a whole
   new component kit with no axe-core pass over it.

---

## Verdicts on the three blocked sibling cards

### KAN-1204 (template margins/breathing-room/line-height fixes on wrap + mobile) — **re-scope**

The premise (4 templates overflow, spacing/line-height need work) is
correct, but §5 shows the mobile-overflow half isn't a per-template
margins problem — it's a shared `CardGrid`/`Gallery` component bug
(fixed column count with no responsive default, no `overflow-wrap` on
title/body text) that happens to currently manifest in 4 of 9 templates
purely because of which words their existing card copy contains.
Hand-tuning margins in just those 4 templates would leave the other 5 (and
every future template or customer-edited card) equally exposed the moment
someone types a long single word into a card title.

Recommend splitting into:
- **A component fix** in `packages/blocks/src/cardgrid/CardGrid.tsx` and
  `.../gallery/Gallery.tsx`: add `overflow-wrap`/`word-break` to title and
  body text, and give `columns` an intrinsic responsive default (e.g. an
  `auto-fit`/`auto-fill` minmax-based base, or a built-in mobile-breakpoint
  fallback) rather than requiring every template to hand-author a
  `responsive.mobile.columns` override that none of the 9 currently set.
  This is the fix that actually closes the "4 templates" finding, and it
  benefits all 9 (8, really — everything but `photographer`).
- **A line-height/measure fix** — likely the same PR as the new card
  recommended below (a `lineHeight` token group + a measure cap on
  `RichText`/`PostDetail`), since "line-height on wrap + mobile" was
  explicitly named in this card's own title.
- **The horizontal-gutter/spacing-rung gaps from §1** fold in here too
  (missing token, not per-template): worth doing in the same pass since
  it's the same "breathing room" territory the card's title already
  names, rather than spinning off a fifth card for it.

### KAN-1206 (visual thumbnail template picker) — **confirm scope**

`TemplateGallery.tsx` renders name + tagline + a button and nothing else —
zero imagery anywhere in the component, and no thumbnail/preview field
exists on `TemplateSummary` or anywhere in the templates package. Visible
directly in `docs/screenshots/design-audit-2026-09/editor-template-picker-
text-only.png`: a single ~450px-wide text column, centered, in a 1440px
viewport, most of the screen unused. The card's framing is exactly the
gap. One thing worth folding in while that file is being touched anyway:
the current single-column list doesn't scale into a real grid on wide
viewports even without images — worth having the same pass produce a
proper responsive multi-column layout, not just add thumbnails to the
existing single column.

### KAN-1207 (block-picker icons + hover preview) — **confirm scope, with a scheduling note**

`packages/puck-adapter/src/config.tsx` confirms every block-picker entry
has a `label` and nothing else — no icon field anywhere in the config, so
the premise is correct. Scope itself is fine as written. Flagging for the
PM: the surface this card is about to touch (Puck's `ComponentList`) is
currently rendered entirely by Puck's own stock `puck.css` — KAN-1205 only
suppressed Puck's header, not this list (§4, with the commit quoted).
Adding MD3-styled icons onto still-non-MD3 list rows will look like a
literal patch rather than a coherent surface. Not asking to block or
expand 1207 on this — just noting it so the PM can decide whether to widen
it slightly (bring the list rows' shape/spacing/state-layer into MD3
alignment while adding icons) or accept the visible seam for now and
handle the surrounding chrome in a later pass.

---

## New cards recommended (not covered by the existing three)

**1. Add a `lineHeight` token group + a measure cap on prose blocks.**
`ThemeTokensSchema` (`packages/schema/src/theme.ts`) needs a sixth token
group — `lineHeight`, keyed the same way `fontSize` is (`xs`/`sm`/`body`/
`lg`/`heading`/`display`) — with defaults targeting ~1.4–1.6× for the
body-ish sizes and ~1.1–1.25× for `heading`/`display`, wired via
`cssVar("lineHeight", ...)` into every block that renders body or heading
text (`RichText`, `Heading`, `CardGrid`, `Testimonial`, `Faq`,
`ContactDetails`, `PostDetail`, `PostList` — roughly 8 files). Pair with a
`max-width`/measure constraint on `RichText` and `PostDetail` (a `ch`-based
cap, e.g. ~65ch, or a new token) so desktop paragraphs stop running to
150+ characters per line regardless of container width. `docs/
BLOCK_CONTRACT.md` already documents the process for adding a token group
("raise it as a schema change... the shape a proposal like that takes") —
this is exactly that situation. (If KAN-1204 gets re-scoped as recommended
above, this could be folded into that same PR rather than being a fully
separate card — the PM's call on how to split the work, not mine.)

**2. Editor: add axe-core coverage for the editor's own UI.**
`ci:budgets` only runs axe-core against published templates
(`checkTemplateBudget`); `apps/editor/`'s own screens — including the
brand-new MD3 kit from EPIC-151 — have never been through an automated
accessibility check. Add a Playwright-driven axe-core pass over the
editor's key screens (login, template picker, site editor canvas, theme
editor, at minimum), gated the same way `budgets.ts` gates templates
(critical impact + `color-contrast` blocking regardless of impact), run
against a live dev-stack session the way this audit's own editor
screenshots were taken.

**3. Enable `axe-core`'s `target-size` rule for templates, and fix
`Nav`/`Footer` tap targets.** The pinned `axe-core@4.13.0` already ships
a `target-size` rule (WCAG 2.2 SC 2.5.8) but it's `enabled: false` by
default and `tools/checks/src/budgets.ts`'s `axe.run()` call never turns
it on. Enabling it (via `runOnly`/`rules`) would catch exactly the gap
this audit found by code inspection: `Nav.tsx`/`Footer.tsx` anchor tags
have no padding, giving ~17–18px-tall tap targets against a 24px (WCAG
2.2 AA) or 44–48px (common mobile-guideline) target. Small, scoped fix:
add padding to those two components' link styles, plus the CI config
change to actually enable and gate on the rule.

---

## Checks run

- `pnpm run design:screenshots` (KAN-1202's tool, unmodified) — all 9
  templates × 3 viewports, plus the editor's template-picker and
  site-editor-canvas screens against a live `make up` stack (seeded
  `owner@example.com` via `pnpm --filter @prefab/api run seed`).
- One ad hoc Playwright script (not committed, per the card's own
  guidance) driving `buildSiteBundle`/`servePreview` directly to render a
  synthetic long-form article page on the `consultant` template's theme,
  for line-height/measure/wrap measurement at 375/768/1440px — the
  9 templates ship only `home.json`, no long-body page, so this was
  necessary to actually see wrap behavior rather than infer it.
- A second ad hoc script measuring real `scrollWidth`/`clientWidth`
  overflow and walking the DOM for the specific overflowing element, for
  all 4 flagged templates at 375px, to root-cause §5 rather than
  eyeballing screenshots.
- Direct WCAG contrast-ratio computation (relative luminance, the actual
  W3C formula) over every template's `color` tokens — not estimated.
- Read the actual installed `axe-core@4.13.0` rule registry
  (`axe._audit.rules`) to confirm `color-contrast`'s `enabled: true` and
  `target-size`'s `enabled: false`, rather than assuming from the rule
  name alone.
- Did **not** run `pnpm run ci`/`ci:budgets`/`ci:fidelity` — this is a
  docs-only change with no code under test, and the repo has no markdown
  lint wired into CI (checked `README.md`'s CI section and
  `.github/workflows/ci.yml`'s job list: gitleaks, lint+typecheck,
  containment/parity, unit, integration, budgets, fidelity, e2e — nothing
  markdown-shaped).

## Friction / UX notes for whoever runs this again

- `pnpm run design:screenshots` itself worked exactly as documented once
  the dev stack and seed were up — no surprises there.
- The seed account isn't created by `make up` alone in a fresh worktree
  the way the README implies ("`make dev`/`make up` already seed it") —
  in this run it needed `DATABASE_URL=postgres://prefab_app:prefab_app@
  localhost:5435/prefab_dev pnpm --filter @prefab/api run seed` run by
  hand first, pointed at the host-mapped Postgres port from `.env`
  (`PREFAB_POSTGRES_PORT`), before the editor screenshots would log in.
  Worth double-checking whether `make up`'s `migrate` step is supposed to
  also seed, or whether the README's wording should say "run the seed
  command below" more plainly rather than "already seed it."
- No committed template ships a long-body/blog-post page — every
  template has exactly one `pages/home.json`. If long-text wrap review
  becomes a recurring need (this card, future ones), it's worth either
  adding one committed long-content fixture page or extending
  `tools/design-review` with an opt-in synthetic-page mode, rather than
  every future audit re-writing this same one-off script.
