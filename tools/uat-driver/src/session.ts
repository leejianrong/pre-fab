import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

/**
 * Everything the driver writes to disk for one run lives under
 * sessions/<sessionId>/ — screenshots an agent can `Read` directly, plus a
 * results.jsonl mirror of every command's stdout line, so a session driven
 * through a background process + FIFO (see README's "adaptive driving"
 * section) can still be inspected after the fact without capturing the
 * process's own stdout.
 */
export interface UatSession {
  id: string;
  dir: string;
  screenshotsDir: string;
  resultsLogPath: string;
}

function sanitizeSessionId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!cleaned) throw new Error(`session id "${id}" has no usable characters`);
  return cleaned;
}

export async function createSession(sessionsRoot: string, requestedId?: string): Promise<UatSession> {
  const id = sanitizeSessionId(requestedId ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const dir = path.join(sessionsRoot, id);
  const screenshotsDir = path.join(dir, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });
  const resultsLogPath = path.join(dir, "results.jsonl");
  return { id, dir, screenshotsDir, resultsLogPath };
}

export async function appendResultLog(session: UatSession, line: unknown): Promise<void> {
  await appendFile(session.resultsLogPath, `${JSON.stringify(line)}\n`, "utf8");
}
