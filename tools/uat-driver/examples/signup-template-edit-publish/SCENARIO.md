# Scenario brief: sign up → pick a template → edit a block → publish

The worked example for KAN-1249 — proves the driver end to end against a
real `make dev` instance. Not one of KAN-1250's real UAT scenarios (those
look for friction; this one exists to prove the tool works), but written in
the same brief format KAN-1250's scenario authors should copy — see
`tools/uat-driver/SCENARIO_BRIEF_TEMPLATE.md`.

## Persona

A first-time visitor who has never used pre-fab before, landing on the
editor with nothing set up: no account, no site. She wants a one-page site
live under her own words, in one sitting, and is willing to read whatever
the screen puts in front of her — but has never seen this app's specific
flows (dev-only inbox, Puck's canvas, the fork-on-use template model).

## Goal

Go from "never used this before" to "a real site is live, with content I
personally edited" — signup, forking a template, changing something, and
publishing, in that order, with no shortcuts (no seeded account, no
API-level scripting of the parts a human would do by hand).

## Starting state

- A `make dev` (or `make up`) stack already running in this worktree — this
  example does not start or stop it. `run.mjs` takes the editor and API
  URLs as flags rather than assuming 5173/8787, since `scripts/dev-ports.sh`
  may have moved them for this worktree (see CLAUDE.md).
- No seeded account needed and none used — this scenario exercises real
  signup (`tools/uat-driver/README.md`'s auth path #2), specifically
  because "sign up" is the first step of the goal. A fresh, timestamped
  email is generated per run so re-running the example never collides with
  a previous run's account.
- No existing site. The template gallery reliably shows "Independent
  Consultant" as the first template card (`packages/templates/src/manifest.ts`
  — first entry in `TEMPLATE_MANIFESTS`), which is why this example clicks
  the first "Use this template" card rather than one matched by name.

## Success criteria

- The signup step lands on `Start from a template` with no seeded account
  involved — the email the scenario itself picked is what verified.
- Forking the template opens the Puck canvas with the template's real
  content in it (`Strategy and operations consulting for growing teams`,
  the Independent Consultant template's hero heading) and a `Publish`
  button visible.
- Editing the hero heading through the canvas + properties panel and
  clicking `Save` shows a `Saved` badge.
- Clicking `Publish` shows `Live` become visible.
- Four screenshots exist under the session's `screenshots/` directory,
  each showing the state described by its name.
- `console --errors` after signup and again after edit+save+publish
  returns real output (see "what this run actually found" below) — proving
  the capture mechanism itself works, not that the app is error-free.

## What to report, and where

This run's findings — not a fixed pass/fail, but what an agent driving
this adaptively would actually notice — are recorded directly in this
card's PR description rather than a separate `findings.md`, since this is
the tool's own proof run, not a KAN-1250 scenario run. A real KAN-1250
scenario subagent should write to
`tools/uat-driver/sessions/<session-id>/findings.md` per the template.

## How to run it

```bash
cd tools/uat-driver
pnpm exec tsx examples/signup-template-edit-publish/run.ts \
  --editor-url http://localhost:5173 \
  --api-url http://localhost:8787
```

(substitute whatever `make dev`/`make up` printed for this worktree).
Screenshots land in
`tools/uat-driver/sessions/signup-template-edit-publish/screenshots/`.
