import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { ConsoleErrorBuffer } from "./console-buffer.js";
import type { UatSession } from "./session.js";

export interface DriverState {
  page: Page;
  consoleBuffer: ConsoleErrorBuffer;
  session: UatSession;
  baseUrl?: string;
  screenshotCounter: number;
}

export type CommandOutcome =
  | { ok: true; command: string; data?: unknown }
  | { ok: false; command: string; error: string }
  | { ok: true; command: "quit" };

/**
 * Playwright's actual built-in selector-string engines — verified against
 * a real page, not assumed: `label=`, `placeholder=`, `alt=` and `title=`
 * look plausible but do not exist as `page.locator()` string engines (they
 * throw "Unknown engine"); only these do.
 */
const KNOWN_ENGINE_PREFIX = /^(css|text|xpath|id|data-testid|role)=/;
/**
 * Only `.`/`#`/`[` at the very start are unambiguous CSS — a class, an id,
 * or an attribute selector. Deliberately narrower than "contains any CSS
 * punctuation": ordinary prose is full of periods and colons ("someone
 * @example.com", "Total: $19.99", "Welcome."), and a heuristic that
 * treated those as CSS sent `wait-for`/`click` down a selector-parse error
 * instead of the substring-text match the caller obviously meant. A
 * scenario author who genuinely wants a descendant/tag selector without
 * one of these three leading characters can still spell it out with an
 * explicit `css=` prefix.
 */
const UNAMBIGUOUS_CSS_START = /^[.#[]/;

/**
 * Resolves a "selector-or-text" argument the way `wait-for` (and, for
 * ergonomics, `click`) accept it: an explicit selector (already prefixed
 * with a real Playwright engine, or starting with unambiguous CSS
 * punctuation) is passed through untouched; anything else — the common
 * case for an agent that doesn't have Playwright's selector syntax
 * memorized, and the only safe default given how much ordinary prose
 * contains "CSS-looking" punctuation — is treated as visible text via the
 * `text=` engine (substring match).
 */
export function resolveSelector(arg: string): string {
  const trimmed = arg.trim();
  if (KNOWN_ENGINE_PREFIX.test(trimmed)) return trimmed;
  if (UNAMBIGUOUS_CSS_START.test(trimmed)) return trimmed;
  return `text=${trimmed}`;
}

/**
 * Splits `<first-arg> <rest of line>` where the first arg is either a
 * single whitespace-free token, or a double-quoted span (for a selector
 * that itself needs a space, e.g. `"text=Email address"`). Used by `fill`,
 * the one command that needs two arguments on one line.
 */
export function splitFirstArg(rest: string): { first: string; remainder: string } {
  const trimmed = rest.trimStart();
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    if (end === -1) throw new Error('unterminated quoted selector — missing closing "');
    return { first: trimmed.slice(1, end), remainder: trimmed.slice(end + 1).trimStart() };
  }
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { first: trimmed, remainder: "" };
  return { first: trimmed.slice(0, spaceIdx), remainder: trimmed.slice(spaceIdx + 1) };
}

function sanitizeFilenamePart(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "shot";
}

function resolveNavUrl(target: string, baseUrl: string | undefined): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return target;
  if (!baseUrl) {
    throw new Error(
      `"${target}" has no scheme and no base URL is set — run \`base-url <url>\` first, or pass --base-url on the command line`,
    );
  }
  return new URL(target, baseUrl).toString();
}

const DEFAULT_TIMEOUT_MS = 15_000;
/**
 * How long an action is given to find its target on the top-level page
 * before this driver falls back to looking inside the first iframe — short
 * on purpose, since a genuine miss should fall back quickly, not eat into
 * the real per-action timeout below.
 */
const TOP_FRAME_PROBE_TIMEOUT_MS = 3_000;
const FRAME_DECISION_POLL_MS = 150;

/** Anything that can build a Locator the same way, whether rooted at the real page or at an iframe's document. */
type LocatorRoot = Pick<Page, "locator" | "getByLabel">;

/** Polls `locator.count()` briefly rather than deciding on a single instant snapshot — a target that's mid-render on the top-level page at the exact moment of the check shouldn't lose to a false "it must be in the iframe" verdict. */
async function appearsWithin(locator: Locator, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if ((await locator.count()) > 0) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, FRAME_DECISION_POLL_MS));
  }
}

/**
 * pre-fab's own editor renders the page-under-construction inside exactly
 * one iframe (the Puck canvas — see e2e/tests/helpers.ts's `canvasFrame`).
 * A block's own text/inputs live inside that iframe, invisible to a plain
 * `page.locator()`, which never pierces frame boundaries. Rather than add a
 * separate frame-addressing command (out of scope for this card's minimum
 * command set), `click`/`fill`/`wait-for` each try the top-level page
 * first (bounded by a short probe timeout) and, only if that doesn't
 * resolve, retry inside the first iframe with the real, full timeout —
 * covering the one nesting depth this app actually has without the caller
 * ever needing to say "in the canvas". Deliberately not smarter than that:
 * a second iframe, or one that isn't first in document order, is out of
 * reach here — a real gap, called out in the README.
 */
async function locateAnywhere(
  page: Page,
  build: (root: LocatorRoot) => Locator,
): Promise<{ locator: Locator; frame: "page" | "iframe" }> {
  const topLocator = build(page);
  if (await appearsWithin(topLocator, TOP_FRAME_PROBE_TIMEOUT_MS)) return { locator: topLocator, frame: "page" };
  return { locator: build(page.frameLocator("iframe").first()), frame: "iframe" };
}

/** True for a target `fill` treats as an explicit selector (passed straight to `.locator()`) rather than a label to resolve via `getByLabel`. */
function isExplicitSelector(trimmed: string): boolean {
  return KNOWN_ENGINE_PREFIX.test(trimmed) || UNAMBIGUOUS_CSS_START.test(trimmed);
}

/**
 * `fill` always targets a form control, so its default resolution for a
 * plain-prose argument is deliberately not the same as `click`/`wait-for`'s
 * `text=` substring match: found live, against this app's own UI, that
 * every text input here (`apps/editor/src/ui/TextField.tsx`, wrapping
 * `<md-outlined-text-field>`) renders its floating label as a decorative
 * `<span>` with its own overlapping wrapper `<div>` — `text=Email address`
 * resolves to that span, and clicking it hits the wrapper div instead
 * ("subtree intercepts pointer events"), never focusing the real `<input>`
 * underneath. `getByLabel` is Playwright's accessible-name-based lookup —
 * it finds the same input this app's own e2e suite already fills via
 * `page.getByLabel(...)` (e2e/tests/helpers.ts's `loginInBrowser`) — so a
 * plain label string here goes through that instead. An explicit
 * `css=`/other engine prefix, or a leading `.`/`#`/`[`, still means what it
 * always means.
 *
 * KAN-1270: deliberately no `.first()` on the label-match branch anymore —
 * see `resolveFormControlLocator`, which needs every match, not just
 * whichever comes first in DOM order.
 */
function buildFillLocator(root: LocatorRoot, target: string): Locator {
  const trimmed = target.trim();
  if (isExplicitSelector(trimmed)) return root.locator(trimmed).first();
  return root.getByLabel(trimmed, { exact: false });
}

const FORM_CONTROL_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * KAN-1270: `getByLabel(..., { exact: false })` matches on substring, so a
 * target string that's a substring of some *container's* own `aria-label`
 * (e.g. `fill Domain ...` matching a `SideSheet`'s
 * `aria-label="Custom domains"` before it matches the real `<input>`
 * nested inside that sheet) can resolve to a non-form-control element.
 * Filling that silently does nothing useful — Playwright's actionability
 * checks accept a plain `<div>` for `.click()`, so the command reported
 * `ok:true` with nothing actually typed, no error surfaced.
 *
 * Walks every match in DOM order and returns the first one that's an
 * actual `input`/`textarea`/`select`. Fails loudly — never falls back to
 * the wrong element — when there's at least one label match but none of
 * them is a form control, since silently guessing is exactly the bug this
 * exists to fix. Zero matches is left alone (returns `.first()` on the
 * empty locator) so the caller's own `.click()`/timeout still reports the
 * normal "not found" error instead of a confusing double message.
 */
async function resolveFormControlLocator(candidates: Locator, target: string): Promise<Locator> {
  const count = await candidates.count();
  if (count === 0) return candidates.first();

  for (let i = 0; i < count; i++) {
    const nth = candidates.nth(i);
    const tagName = await nth.evaluate((el) => el.tagName).catch(() => null);
    if (tagName && FORM_CONTROL_TAGS.has(tagName)) return nth;
  }

  throw new Error(
    `"${target}" matched ${count} element(s) by label, but none of them is an input/textarea/select — ` +
      "refusing to fill a non-form-control element (e.g. a dialog's own aria-label matching before the " +
      "real field nested inside it). Use an explicit selector (css=..., #id, [name=...], etc.) to target it directly.",
  );
}

export async function executeCommand(state: DriverState, verb: string, rest: string): Promise<CommandOutcome> {
  switch (verb) {
    case "help": {
      return {
        ok: true,
        command: verb,
        data: {
          commands: [
            "base-url <url> — set/override the base URL used to resolve relative nav targets",
            "nav <url> — navigate the page (absolute, or relative to base-url)",
            "click <selector-or-text> — real click via Playwright locator.click()",
            'fill <selector-or-label> <text> — real click + select-all + pressSequentially (quote the target if it has spaces, e.g. "Email address"); a plain label resolves via getByLabel, not text substring — see README',
            "press <key> — keyboard.press() on whatever currently has focus, e.g. Enter, Control+A",
            "wait-for <selector-or-text> — wait until visible (15s timeout)",
            "screenshot [name] — PNG under sessions/<id>/screenshots/",
            "console --errors — drain console.error/pageerror events seen since the last check",
            "quit | exit — close the browser and end the session",
          ],
        },
      };
    }

    case "base-url": {
      const url = rest.trim();
      if (!url) return { ok: false, command: verb, error: "usage: base-url <url>" };
      state.baseUrl = url;
      return { ok: true, command: verb, data: { baseUrl: url } };
    }

    case "nav": {
      const target = rest.trim();
      if (!target) return { ok: false, command: verb, error: "usage: nav <url>" };
      const url = resolveNavUrl(target, state.baseUrl);
      const response = await state.page.goto(url, { waitUntil: "load", timeout: DEFAULT_TIMEOUT_MS });
      return { ok: true, command: verb, data: { url, status: response?.status() ?? null } };
    }

    case "click": {
      const target = rest.trim();
      if (!target) return { ok: false, command: verb, error: "usage: click <selector-or-text>" };
      const selector = resolveSelector(target);
      const { locator, frame } = await locateAnywhere(state.page, (root) => root.locator(selector).first());
      await locator.click({ timeout: DEFAULT_TIMEOUT_MS });
      return { ok: true, command: verb, data: { selector, frame } };
    }

    case "fill": {
      const { first, remainder } = splitFirstArg(rest);
      if (!first || !remainder) {
        return { ok: false, command: verb, error: "usage: fill <selector-or-label> <text> (quote the target if it has spaces)" };
      }
      const { locator: candidateLocator, frame } = await locateAnywhere(state.page, (root) => buildFillLocator(root, first));
      // KAN-1270: an explicit selector was already narrowed to `.first()`
      // inside buildFillLocator and is trusted as-is; a label match still
      // needs filtering down to an actual form control (see
      // resolveFormControlLocator's own comment).
      const locator = isExplicitSelector(first) ? candidateLocator : await resolveFormControlLocator(candidateLocator, first);
      // Real input pipeline — click to focus, select the existing value,
      // then type the replacement one keystroke at a time via
      // `pressSequentially` (Playwright's real-keyboard-event API, the
      // current name for what used to be `.type()`) — never
      // `.evaluate(el => el.value = ...)`, which bypasses React's
      // controlled-input tracking and silently never fires onChange. This
      // is the exact gotcha CLAUDE.md/this card called out to not
      // reintroduce. Deliberately not plain `.fill()`: proven against a
      // real `make dev` instance to not reliably replace an existing value
      // in the Puck canvas's property-panel fields — see README's "REPL
      // quirks" section.
      await locator.click({ timeout: DEFAULT_TIMEOUT_MS });
      await locator.press("Control+A");
      await locator.pressSequentially(remainder, { timeout: DEFAULT_TIMEOUT_MS });
      return { ok: true, command: verb, data: { target: first, text: remainder, frame } };
    }

    case "press": {
      const key = rest.trim();
      if (!key) return { ok: false, command: verb, error: "usage: press <key>" };
      await state.page.keyboard.press(key);
      return { ok: true, command: verb, data: { key } };
    }

    case "wait-for": {
      const target = rest.trim();
      if (!target) return { ok: false, command: verb, error: "usage: wait-for <selector-or-text>" };
      const selector = resolveSelector(target);
      const { locator, frame } = await locateAnywhere(state.page, (root) => root.locator(selector).first());
      await locator.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT_MS });
      return { ok: true, command: verb, data: { selector, frame } };
    }

    case "screenshot": {
      state.screenshotCounter += 1;
      const requestedName = rest.trim();
      const base = requestedName
        ? sanitizeFilenamePart(requestedName)
        : `shot-${String(state.screenshotCounter).padStart(3, "0")}`;
      const fileName = base.endsWith(".png") ? base : `${base}.png`;
      const filePath = path.join(state.session.screenshotsDir, fileName);
      await state.page.screenshot({ path: filePath, fullPage: true });
      return { ok: true, command: verb, data: { path: filePath } };
    }

    case "console": {
      const flag = rest.trim();
      if (flag !== "--errors") {
        return { ok: false, command: verb, error: "usage: console --errors" };
      }
      const events = state.consoleBuffer.drain();
      return { ok: true, command: verb, data: { events } };
    }

    case "quit":
    case "exit":
      return { ok: true, command: "quit" };

    case "":
      return { ok: true, command: verb, data: null };

    default:
      return { ok: false, command: verb, error: `unknown command "${verb}" — try \`help\`` };
  }
}
