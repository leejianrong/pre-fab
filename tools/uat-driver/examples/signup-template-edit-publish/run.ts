#!/usr/bin/env -S pnpm exec tsx
// Worked example for KAN-1249: proves the REPL driver (tools/uat-driver/src/driver.ts)
// actually works against a real, running `make dev` instance — real signup,
// real dev-inbox verification code, forking a template, editing a block in
// the Puck canvas, saving, publishing, and checking for console errors along
// the way. See SCENARIO.md in this directory for the scenario brief this
// walks through, and tools/uat-driver/README.md for the command vocabulary.
//
// This script is the orchestrator, not the driver itself: it starts the
// driver as a child process and talks to it over its own stdin/stdout — the
// same "pipe a command, read the JSON result, decide the next command"
// loop KAN-1250's subagents will do, just scripted here end to end instead
// of adaptively. (For a genuinely adaptive, multi-turn session driven from
// separate tool calls — the shape KAN-1250 actually needs — see the
// --fifo flag in the README instead of this direct-child-process pattern,
// which only works because one long-lived Node process is what's issuing
// every command here.)
//
// Usage:
//   pnpm exec tsx run.ts --editor-url http://localhost:5173 --api-url http://localhost:8787

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(here, "..", "..");
const driverEntry = path.join(packageRoot, "src", "driver.ts");

interface Args {
  editorUrl: string;
  apiUrl: string;
  session: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { session: "signup-template-edit-publish" };
  for (let i = 0; i < argv.length; i++) {
    const value = () => {
      i += 1;
      const v = argv[i];
      if (v === undefined) throw new Error(`${argv[i - 1]} needs a value`);
      return v;
    };
    if (argv[i] === "--editor-url") out.editorUrl = value();
    else if (argv[i] === "--api-url") out.apiUrl = value();
    else if (argv[i] === "--session") out.session = value();
    else throw new Error(`unknown argument "${argv[i]}"`);
  }
  if (!out.editorUrl || !out.apiUrl) {
    throw new Error("usage: run.ts --editor-url <url> --api-url <url> [--session <id>]");
  }
  return out as Args;
}

const { editorUrl, apiUrl, session } = parseArgs(process.argv.slice(2));

const child = spawn("pnpm", ["exec", "tsx", driverEntry, "--base-url", editorUrl, "--session", session], {
  cwd: packageRoot,
  stdio: ["pipe", "pipe", "inherit"],
});
child.on("error", (error) => {
  console.error(`[run.ts] failed to start driver: ${error.message}`);
  process.exitCode = 1;
});

interface CommandResult {
  ok: boolean;
  command: string;
  data?: { events?: unknown[]; [key: string]: unknown };
  error?: string;
  [key: string]: unknown;
}

const rl = createInterface({ input: child.stdout, terminal: false });
const queue: CommandResult[] = [];
const waiters: Array<(result: CommandResult) => void> = [];
rl.on("line", (line) => {
  let parsed: CommandResult;
  try {
    parsed = JSON.parse(line) as CommandResult;
  } catch {
    return; // not a result line (shouldn't happen — driver only prints JSON to stdout)
  }
  const waiter = waiters.shift();
  if (waiter) waiter(parsed);
  else queue.push(parsed);
});

function nextResult(): Promise<CommandResult> {
  if (queue.length) return Promise.resolve(queue.shift()!);
  return new Promise((resolve) => waiters.push(resolve));
}

/** Sends one command, waits for its result line, and throws (with the full result) if it failed — a scenario script should stop at the first sign of real trouble, same as a first-time user would. */
async function send(command: string): Promise<CommandResult> {
  process.stdout.write(`-> ${command}\n`);
  child.stdin.write(`${command}\n`);
  const result = await nextResult();
  process.stdout.write(`<- ${JSON.stringify(result)}\n`);
  if (!result.ok) {
    throw new Error(`command failed: "${command}"\n${JSON.stringify(result, null, 2)}`);
  }
  return result;
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const email = `uat-driver-example-${stamp}@example.com`;
  const slug = `uat-driver-example-${stamp}`;

  // ---- Real signup (README.md's "Usage" section / dev-login flow #2) ----
  await send("nav /");
  await send("click text=First time? Create an account");
  await send(`fill "Email address" ${email}`);
  await send("click text=Send me a code");
  await send(`wait-for ${email}`); // SignupScreen echoes the email back once the code is "sent"

  // The driver only drives the browser — reading the dev-only inbox is a
  // plain HTTP call, made here exactly the way a KAN-1250 scenario
  // subagent would from its own tool, not something the REPL has a
  // command for.
  const emailsResponse = await fetch(`${apiUrl}/v1/dev/emails?to=${encodeURIComponent(email)}`);
  if (!emailsResponse.ok) throw new Error(`GET /v1/dev/emails failed: ${emailsResponse.status}`);
  const messages = (await emailsResponse.json()) as Array<{ text: string }>;
  const codeMatch = /\b(\d{6})\b/.exec(messages.at(-1)?.text ?? "");
  if (!codeMatch) throw new Error(`no 6-digit code found in the dev inbox for ${email}: ${JSON.stringify(messages)}`);
  const code = codeMatch[1];

  await send(`fill "Verification code" ${code}`);
  await send("click text=Verify and continue");
  await send("wait-for Start from a template");
  await send("screenshot 01-signed-up-site-picker");

  // ---- Pick a template (first "Use this template" card — Independent Consultant, per templates seed order) ----
  await send("click text=Use this template");
  await send(`fill "Site slug" ${slug}`);
  await send('fill "Site name" UAT Driver Example');
  await send("click text=Create my site");
  await send("wait-for Publish");
  await send("screenshot 02-template-forked-in-canvas");

  // Baseline: drain whatever console noise the boot sequence produced so
  // the check right after the real edit below reflects only that edit.
  await send("console --errors");

  // ---- Edit a block: the forked template's real hero heading, inside the Puck canvas iframe ----
  await send("click text=Strategy and operations consulting");
  await send('fill css=input[name="heading"]:visible UAT Driver Example — Edited Heading');
  await send("click Save");
  await send("wait-for Saved");
  await send("screenshot 03-block-edited-and-saved");

  // ---- Publish ----
  await send("click Publish");
  await send("wait-for Live");
  await send("screenshot 04-published");

  const errorsAfterEdit = await send("console --errors");
  process.stdout.write(`\nconsole errors observed after the edit+save+publish sequence: ${JSON.stringify(errorsAfterEdit.data?.events, null, 2)}\n`);

  await send("quit");
  process.stdout.write("\nDONE — worked example completed without a failed command.\n");
}

main().catch((error: unknown) => {
  console.error(`\n[run.ts] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  try {
    child.stdin.end();
  } catch {
    // already closed
  }
  process.exitCode = 1;
});
