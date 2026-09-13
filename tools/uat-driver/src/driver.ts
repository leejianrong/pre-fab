#!/usr/bin/env node
import { createInterface } from "node:readline";
import { openSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./chromium.js";
import { ConsoleErrorBuffer } from "./console-buffer.js";
import { createSession, appendResultLog } from "./session.js";
import { executeCommand, type DriverState } from "./commands.js";
import { acquireFifoLock, type FifoLock } from "./fifo-lock.js";

/**
 * tools/uat-driver's REPL: launches one browser+context+page for the whole
 * process lifetime and executes newline-delimited commands read from
 * stdin, printing one JSON result line per command to stdout (and
 * mirroring it to sessions/<id>/results.jsonl). See tools/uat-driver/README.md
 * for the command vocabulary and the two ways an agent can drive this —
 * pipe a whole scenario script at once, or feed it commands one at a time
 * through a long-lived FIFO for genuinely adaptive, screenshot-then-decide
 * driving.
 */

interface Args {
  baseUrl?: string;
  session?: string;
  sessionsRoot: string;
  fifo?: string;
}

function parseArgs(argv: string[]): Args {
  const repoDefaultSessionsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sessions");
  const args: Args = { sessionsRoot: repoDefaultSessionsRoot };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      const value = argv[i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    switch (arg) {
      case "--base-url":
        args.baseUrl = next();
        break;
      case "--session":
        args.session = next();
        break;
      case "--sessions-root":
        args.sessionsRoot = path.resolve(next());
        break;
      case "--fifo":
        args.fifo = next();
        break;
      default:
        throw new Error(`unknown argument "${arg}" — expected --base-url, --session, --sessions-root, or --fifo`);
    }
  }
  return args;
}

function openStdinLike(fifoPath: string | undefined): NodeJS.ReadableStream {
  if (!fifoPath) return process.stdin;
  // Opened "r+" (read-write) rather than piped in by shell redirection so
  // this process holds its own write end open on the FIFO — a FIFO with no
  // writer delivers EOF to the reader the instant the *last* writer closes,
  // which would end a plain `readline` loop after the very first external
  // `echo cmd > fifo`. Holding r+ ourselves means new external writers can
  // keep opening and closing the same path over and over (one `echo`/write
  // per command) without this process ever seeing EOF in between — that's
  // what makes a long-lived, adaptive, one-command-at-a-time session work.
  const fd = openSync(fifoPath, "r+");
  return fs.createReadStream("", { fd });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const session = await createSession(args.sessionsRoot, args.session);

  // KAN-1270: refuses to start (rather than silently corrupting a session
  // — see fifo-lock.ts's own comment) if another live process already
  // holds this FIFO path. Acquired before touching the FIFO itself, and
  // before the (much more expensive) browser launch below, so a doomed
  // run fails fast.
  const fifoLock: FifoLock | undefined = args.fifo ? acquireFifoLock(args.fifo) : undefined;
  const releaseFifoLock = () => fifoLock?.release();
  process.once("exit", releaseFifoLock);

  const browser = await launchChromium();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleBuffer = new ConsoleErrorBuffer(page);

  const state: DriverState = {
    page,
    consoleBuffer,
    session,
    baseUrl: args.baseUrl,
    screenshotCounter: 0,
  };

  process.stderr.write(
    `[uat-driver] session "${session.id}" ready — screenshots: ${session.screenshotsDir}, results log: ${session.resultsLogPath}${
      args.baseUrl ? `, base-url: ${args.baseUrl}` : " (no --base-url — set one with the base-url command before nav-ing a relative path)"
    }\n`,
  );

  const rl = createInterface({ input: openStdinLike(args.fifo), terminal: false });

  let closing = false;
  async function shutdown(): Promise<void> {
    if (closing) return;
    closing = true;
    rl.close();
    await context.close();
    await browser.close();
  }

  // A background FIFO-driven run (README's "adaptive driving" section) is
  // normally stopped by SIGINT/SIGTERM rather than a `quit` command reaching
  // it through the FIFO — without an explicit handler here Node's default
  // disposition for those still ends the process, but skips the `await`s
  // above, which can leave the browser process (and, more importantly, the
  // FIFO lock file) behind. `process.exit()` after `shutdown()` finishes
  // still fires the `"exit"` listener above, so the lock gets released
  // either way.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      shutdown()
        .catch((error) => process.stderr.write(`[uat-driver] error during ${signal} shutdown: ${String(error)}\n`))
        .finally(() => process.exit(0));
    });
  }

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const spaceIdx = line.indexOf(" ");
    const verb = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).toLowerCase();
    const rest = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1);

    const startedAt = new Date().toISOString();
    const started = Date.now();
    let outcome;
    try {
      outcome = await executeCommand(state, verb, rest);
    } catch (error) {
      outcome = { ok: false as const, command: verb, error: error instanceof Error ? error.message : String(error) };
    }
    const result = { ...outcome, raw: line, startedAt, durationMs: Date.now() - started };

    process.stdout.write(`${JSON.stringify(result)}\n`);
    await appendResultLog(session, result);

    if (outcome.ok && outcome.command === "quit") break;
  }

  await shutdown();
}

main().catch((error) => {
  process.stderr.write(`[uat-driver] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
