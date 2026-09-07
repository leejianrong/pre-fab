# Scenario brief: <name>

One of these per scenario KAN-1250 spawns a subagent to drive. Copy this file
into `tools/uat-driver/examples/<scenario-slug>/SCENARIO.md` (worked example)
or wherever KAN-1250 keeps its real scenario briefs, fill it in, and hand it
to the subagent as its whole task prompt — it should not need anything else
to get started.

## Persona

Who is "using" the app, in one or two sentences. Be specific about what they
already know and don't — that's what makes the driving *adaptive* rather
than a fixed script. Example: "A café owner who has never used a website
builder before. She knows what she wants her site to say, not how any of
this software works — she will read labels and buttons literally."

## Goal

The one thing this persona is trying to accomplish, stated as an outcome,
not a sequence of steps. Example: "Get a one-page site for her café live at
a public URL, with her actual hours and a photo, in one sitting."

## Starting state

Exactly what exists before the subagent's first command — this is what lets
it pick up mid-flow instead of always starting from a blank slate. State:

- Which base URL / port to drive (an already-running `make dev` stack — see
  the scenario runner's instructions for how the port was allocated; do not
  hardcode 5173/8787, `scripts/dev-ports.sh` may have moved them for this
  worktree).
- Which auth path applies — see `tools/uat-driver/README.md`'s "Auth and
  seed data" section for the two options and pick the one this scenario
  actually needs:
  - the seeded pro-plan account (`e2e-owner@example.com`) — only if this
    exact scenario runs against the `prefab_e2e` database (rare outside
    this driver's own worked example; most `make dev` runs don't have it).
  - the real dev-login flow (sign up, read the code back from
    `GET /v1/dev/emails?to=<email>`) — the default for anything driving a
    plain `make dev` Postgres, including any scenario that wants to test
    signup/onboarding itself.
- Any site/data that must already exist (e.g. "a site named X, already
  published") and how to create it if it doesn't — either through the UI
  itself as the first steps, or noted as a precondition the scenario runner
  set up out of band.

## Success criteria

Concrete, checkable outcomes — not "it worked," but what a reviewer with no
context could verify from the findings report alone. Example:

- The site picker shows a newly created site after template selection.
- Editing the hero heading in the canvas and clicking Save shows a "Saved"
  badge within 10s.
- Clicking Publish shows a "Live" badge, and the printed live URL actually
  serves the edited heading text.
- `console --errors` after each major step returns no unexpected errors
  (list which errors, if any, would be *expected* and thus not friction —
  e.g. a known third-party embed warning).

## What to report, and where

KAN-1250's subagents are looking for friction a first-time user would hit,
not writing pass/fail assertions (`e2e/*.spec.ts` already does that). For
each step where something was confusing, slow, broken, or produced a
console error underneath a page that otherwise looked fine, capture:

- what you did (the command(s))
- what you expected
- what actually happened — reference the screenshot filename
  (`sessions/<session-id>/screenshots/<name>.png`) and any console errors
  from `console --errors`
- how bad it is: blocks the goal entirely / workaround exists but a real
  first-time user probably wouldn't find it / cosmetic

Write the findings as a plain Markdown report. Unless the scenario runner
tells you a different path, write it to
`tools/uat-driver/sessions/<session-id>/findings.md` — right next to the
screenshots it references, so a reviewer opening the session directory has
everything in one place.
