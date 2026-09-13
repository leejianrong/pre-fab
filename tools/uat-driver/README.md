# @prefab/uat-driver

KAN-1249: a reusable driver + scenario framework for **agent-driven UAT** —
an agent adaptively driving a real, running pre-fab instance the way a
first-time user would, screenshotting and deciding the next move, as
opposed to `e2e/*.spec.ts`'s 30 fixed-assertion Playwright specs
(`e2e/playwright.config.ts`). This package builds the tool; KAN-1250 is the
follow-up card that spawns subagents to actually drive scenarios with it
(signup, blog, bookings, payments, e-commerce checkout, billing
gates/export) and report friction.

This is dev/QA tooling, not a product or control-plane package — ADR-0010's
runtime-containment rule and ADR-0003's CLI/MCP/API three-surface
invariant don't apply here; it isn't a mutation surface (verified against
what `tools/checks/src/containment.ts` and `tools/checks/src/parity.ts`
actually scan — neither touches `tools/`'s general contents beyond the
specific `packages/publish`/`packages/blocks`/`packages/runtime` rules).

## What's here

- `src/driver.ts` — the REPL: launches one browser + context + page and
  executes newline-delimited commands read from stdin, one JSON result
  line per command on stdout.
- `src/commands.ts` — the command vocabulary (below).
- `src/chromium.ts` — same sandboxed-Chromium-if-present convention as
  `e2e/playwright.config.ts:10-16` and `tools/design-review`.
- `SCENARIO_BRIEF_TEMPLATE.md` — the brief format KAN-1250's scenario
  authors should copy per scenario.
- `examples/signup-template-edit-publish/` — one scenario wired end to
  end, proving screenshots + console-error capture actually work against a
  real `make dev` instance (see its `SCENARIO.md`).
- `sessions/` — gitignored. Everything a driver run writes: PNGs an agent
  can `Read` directly, and a `results.jsonl` mirror of every command's
  result line.

## Quick start

```bash
cd tools/uat-driver
pnpm exec tsx src/driver.ts --base-url http://localhost:5173 --session my-session
```

Then type (or pipe) commands, one per line:

```
nav /
wait-for Sign in
fill "Seeded account email" e2e-owner@example.com
click Sign in
wait-for Your sites
screenshot picker
console --errors
quit
```

Each line prints one JSON result to stdout, e.g.:

```json
{"ok":true,"command":"click","data":{"selector":"text=Sign in","frame":"page"},"raw":"click Sign in","startedAt":"...","durationMs":53}
```

`--base-url` is optional on the command line — set (or change) it later
with the `base-url <url>` REPL command instead. Either way, **always pass
the actual URL this worktree's `make dev`/`make up` printed**, never a
hardcoded `5173`/`8787` — `scripts/dev-ports.sh` picks the next free port
per worktree (CLAUDE.md's "Multiple subagents running `make dev`..."
section), and KAN-1250's concurrent scenario runs must not collide on a
hardcoded port.

## Command vocabulary

| Command | What it does |
|---|---|
| `base-url <url>` | Set/override the base URL relative `nav` targets resolve against. |
| `nav <url>` | Navigate the page. Absolute (`http://...`) or relative to `base-url`. |
| `click <selector-or-text>` | Real `locator.click()`. |
| `fill <selector-or-label> <text>` | Real click + select-all + `pressSequentially` (character-by-character keyboard events) — never `.evaluate(el => el.value = ...)`. Quote the target if it has spaces. |
| `press <key>` | `keyboard.press()` on whatever currently has focus — `Enter`, `Control+A`, etc. |
| `wait-for <selector-or-text>` | Wait until visible (15s timeout). |
| `screenshot [name]` | Full-page PNG under `sessions/<id>/screenshots/`. Name defaults to `shot-NNN`. |
| `console --errors` | Drain (and clear) `console.error`/`pageerror` events seen since the last check. |
| `help` | List commands. |
| `quit` / `exit` | Close the browser, end the session. |

### Selector-or-text resolution

Most arguments accept either a real Playwright selector or plain visible
text — an agent shouldn't need to know Playwright's selector syntax by
heart to drive this:

- An explicit engine prefix (`css=`, `text=`, `xpath=`, `id=`,
  `data-testid=`, `role=`) is used exactly as given. These are the only
  selector-string engines Playwright actually supports — `label=`,
  `placeholder=`, `alt=`, `title=` **look** plausible but throw "Unknown
  engine"; verified directly, not assumed (see `commands.ts`'s comment).
- A target starting with `.`, `#`, or `[` is treated as CSS (a class, an
  id, or an attribute selector).
- Anything else is substring text — for `click`/`wait-for`, wrapped as
  Playwright's `text=` engine.

`fill` is the one exception: a plain (non-selector, non-prefixed) target
resolves via `getByLabel(...)` instead of `text=`. Found live, against
this app's own UI: every text field here
(`apps/editor/src/ui/TextField.tsx`, wrapping `<md-outlined-text-field>`)
renders its floating label as a decorative `<span>` sitting under an
overlapping wrapper `<div>` — `text=Email address` resolves to that span,
and clicking it hits the wrapper instead ("subtree intercepts pointer
events"), never reaching the real `<input>`. `getByLabel` is
accessible-name-based and finds the actual input — the same way this
codebase's own `e2e/tests/helpers.ts`'s `loginInBrowser` already fills it
(`page.getByLabel(/seeded account email/i)`).

`getByLabel(..., { exact: false })` matches on substring, which can also
match a *container's* own `aria-label` — e.g. `fill Domain ...` matching a
`SideSheet`'s `aria-label="Custom domains"` before it matches the real
`<input>` nested inside that sheet (found live, KAN-1250). `fill` filters
every label match down to the first actual `input`/`textarea`/`select`
(`commands.ts`'s `resolveFormControlLocator`) rather than trusting
whichever comes first in DOM order, and fails loudly — instead of the
previous silent `ok:true` with nothing typed — if there's a label match
but none of them is a form control.

Only `.`/`#`/`[` count as "unambiguous CSS" on purpose — not "contains any
CSS-looking punctuation". Ordinary prose is full of periods and colons
("someone@example.com", "Total: $19.99", "Welcome."); an earlier version
of this heuristic treated those as CSS and sent `wait-for`/`click` into a
selector-parse error instead of the substring match the caller obviously
meant. If you need a real descendant/tag selector that doesn't start with
one of those three characters, spell it out with `css=`.

### The Puck canvas (iframe)

pre-fab's editor renders the page-under-construction inside exactly one
iframe (`e2e/tests/helpers.ts`'s `canvasFrame` — `page.frameLocator("iframe").first()`).
`click`/`fill`/`wait-for` each try the top-level page first (a brief,
polled probe, ~3s) and, only if that doesn't resolve, retry inside the
first iframe with the real 15s timeout — so a scenario script never needs
to say "in the canvas" to click block content. This covers the one nesting
depth this app actually has. It does **not** cover a second iframe, or one
that isn't first in document order — out of scope for this card's minimum
command set.

One real consequence: `wait-for`/`click`/`fill` commit to "top page" or
"iframe" within that ~3s probe window. If a top-level element is slow to
render (rare, but possible under load) and doesn't exist in the canvas
either, the driver reports a timeout after committing to the iframe
branch — even though the element would have shown up on the page a moment
later. If you hit this, split it: `wait-for` something already on screen
first (to let the page settle), then `wait-for` the real target.

## Auth and seed data

Two paths, matching README.md's own "Usage" section — pick whichever this
scenario actually needs, and say which one in the scenario brief's
"Starting state":

**1. The seeded pro-plan owner account** (`e2e-owner@example.com`,
`e2e/global-setup.ts:8-43`) — for scenarios that don't test signup itself.
**This seed only exists in the `prefab_e2e` database e2e's global-setup
creates.** It will not exist against a plain `make dev`/`make up` Postgres
unless you seed it yourself or point this driver at the e2e stack
specifically. `make dev`'s own default seed is a *different* account,
`owner@example.com` (`apps/api/src/seed.ts`, `SEED_ACCOUNT_EMAIL`) — do
not confuse the two. Log in with either via the editor's own login screen
(`LoginScreen.tsx` — the "Seeded account email" field, a stand-in for real
auth kept for local dev/tests, same mechanism the CLI's `dev.login` and
the e2e suite use):

```
nav /
fill "Seeded account email" owner@example.com
click Sign in
wait-for Your sites
```

**2. The real dev-login (signup) flow** — for scenarios that need to
exercise real signup/onboarding end to end, or any scenario running
against a plain `make dev` stack with no seed at all. README.md's "Usage"
section: sign up with any email, then read the verification code back from
the dev-only inbox endpoint, `GET /v1/dev/emails?to=<email>`. That
endpoint call is a plain HTTP request — **not** something this REPL has a
command for; make it from whatever is orchestrating the driver (the
calling agent's own `curl`/`fetch`, exactly like
`examples/signup-template-edit-publish/run.ts` does), then feed the code
back in via `fill`:

```
nav /
click text=First time? Create an account
fill "Email address" someone@example.com
click text=Send me a code
```

then, outside the REPL:

```bash
curl -s "$API_URL/v1/dev/emails?to=someone@example.com" | jq -r '.[-1].text'
# pull the 6-digit code out of the message text
```

then back in the REPL:

```
fill "Verification code" 123456
click text=Verify and continue
wait-for Start from a template
```

## Driving it adaptively

The point of this tool over `e2e/*.spec.ts` is that an agent can see one
command's result before deciding the next — not run a whole pre-written
script blind. Two ways to get that, depending on how the calling agent is
structured:

**One long-lived process the agent talks to directly.** If the agent (or
its own orchestrating script) can keep a single Node `child_process` alive
across the whole scenario — write a line to its stdin, read the JSON
result from its stdout, decide, repeat — that's the simplest option and
needs nothing extra from this driver. `examples/signup-template-edit-publish/run.ts`
does exactly this (see its source for the pattern: a `readline` interface
over `child.stdout`, a small result queue, `send(command)` that writes and
awaits the next line).

**Commands arriving from separate tool calls over time** (the more likely
shape for a KAN-1250 subagent issuing one Bash-tool command per decision,
with no persistent shell of its own between calls) — pass `--fifo <path>`
instead of relying on stdin redirection. The driver opens that path itself
in `r+` (read-write) mode rather than being piped into via shell
redirection, specifically so it never sees EOF: a FIFO with no writer
delivers EOF to whatever's reading the instant the *last* writer closes,
which would end a plain `readline` loop after the very first external
`echo cmd > fifo`. Holding its own write end open means external writers
can keep opening and closing that same path — one write per command, from
as many separate processes/tool calls as you like, spread over as much
time as you like — without the driver ever seeing EOF in between:

```bash
mkfifo /tmp/uat-session.fifo
pnpm exec tsx src/driver.ts --base-url http://localhost:5173 \
  --session my-session --fifo /tmp/uat-session.fifo \
  > sessions/my-session/stdout.log 2>&1 &

echo 'nav /' > /tmp/uat-session.fifo
# ... later, a separate tool call, after deciding what to do next ...
echo 'screenshot after-nav' > /tmp/uat-session.fifo
```

Since the background process's own stdout isn't easy to read back from a
separate tool call either, every result is also mirrored to
`sessions/<id>/results.jsonl` — `tail`/`Read` that file to see what
happened after each command, instead of trying to capture the background
process's stdout directly.

**One driver per FIFO path, enforced.** Two driver processes pointed at
the same `--fifo` path (a relaunch after an agent thought a start had
failed, or two scenario runs reusing a stale path) would otherwise both
hold their own write end open on it and race every external write —
whichever process's `readline` happens to read a given line wins,
nondeterministically, even if the "winner" is a process that already
crashed. `--fifo` acquires a PID-file lock at `<fifo-path>.lock` on
startup (`src/fifo-lock.ts`) and refuses to start with a clear error if
another live process already holds it, instead of starting anyway and
silently corrupting the session. A lock left behind by a process that's no
longer running is detected (`process.kill(pid, 0)`) and reclaimed
automatically. Use a distinct `--fifo` path per concurrent session — the
lock doesn't (and can't) make one FIFO safe for two simultaneous sessions,
it just stops that from failing silently.

## Known gaps under concurrent scenario runs

Two more KAN-1250-found gaps that are real but out of scope to fix here —
work around them rather than assume they're handled:

- **Screenshots can come back blank under Chromium resource contention.**
  When several scenario subagents run concurrently, a `screenshot` can
  capture a blank/unrendered frame even though the preceding `wait-for`
  already reported the target visible — a rendering-thread timing issue
  under CPU/GPU contention between multiple Chromium instances, not a bug
  in `wait-for` itself. If a screenshot looks suspiciously blank, retake it
  (a second `screenshot` a moment later) before concluding the page itself
  is broken.
- **`~/.prefab/config.json` is shared machine-wide.** The CLI's own auth
  config (`apps/cli/src/config.ts`) has no concept of concurrent sessions —
  two scenario agents both running `prefab login`/`prefab signup` (or a
  scenario's own setup shelling out to the CLI) clobber each other's
  session cookie in the same file. This driver's own browser-based `fill
  ...`/`click ...` login flow isn't affected (it drives the editor's own
  cookie-setting login screen, not the CLI), but any scenario that also
  shells out to the `prefab` CLI alongside driving the browser should
  capture the token/cookie explicitly (`prefab token create`, or read the
  session cookie the login screen set) and pass it via `--token`/an
  explicit cookie header rather than relying on `~/.prefab/config.json`,
  if another concurrent agent might also be authenticating.

## Writing a scenario for KAN-1250

Copy `SCENARIO_BRIEF_TEMPLATE.md` to `<scenario-slug>/SCENARIO.md` (see
`examples/signup-template-edit-publish/` for a filled-in one) — persona,
goal, starting state (base URL, which auth path, any preconditions),
success criteria, and where to write the findings report. Hand the whole
file to the subagent as its task; it should need nothing else to start
driving.

## Worked example

`examples/signup-template-edit-publish/run.ts` proves the whole pipeline
against a real `make dev` instance: real signup, reading the real
verification code back from the dev inbox, forking the first template,
editing its hero heading through the Puck canvas, saving, publishing, and
checking for console errors along the way.

```bash
cd tools/uat-driver
pnpm exec tsx examples/signup-template-edit-publish/run.ts \
  --editor-url http://localhost:5173 --api-url http://localhost:8787
```

(use whatever `make dev`/`make up` printed for your worktree). See its
`SCENARIO.md` for the full brief, and this card's PR description for what
that run actually found.
