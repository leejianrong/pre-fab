import { openSync, writeSync, closeSync, readFileSync, unlinkSync } from "node:fs";

/**
 * KAN-1270: two driver processes started against the same `--fifo` path
 * (an agent that retried a launch it thought had failed, or two scenario
 * runs that reused a stale path) both hold their own `r+` write end open on
 * it (see driver.ts's `openStdinLike` for why `r+` matters) and both race
 * every external `echo cmd > fifo` write — whichever process's own
 * `readline` happens to read a given line wins, nondeterministically,
 * *including a process that already crashed but never released the FIFO
 * (its fd stays valid until the OS cleans it up)*. Neither loses visibly:
 * both look like a normal running driver, so a command silently vanishing
 * into the other process's session is the only symptom.
 *
 * A PID file at `<fifoPath>.lock`, created with the equivalent of `open(...,
 * O_CREAT | O_EXCL)` (Node's `"wx"` flag — atomically fails if the file
 * already exists, no separate check-then-create race), is enough to catch
 * this without a native flock binding: only one process can ever win that
 * exclusive create for a given path. A lock left behind by a process that
 * no longer exists (crashed, killed -9) is detected via `process.kill(pid,
 * 0)` — signal 0 sends nothing, just probes whether the pid is alive — and
 * reclaimed rather than wedging every future run of this driver shut.
 */
export interface FifoLock {
  release(): void;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH: no such process — the lock is stale. EPERM: it exists but we
    // can't signal it (different user) — treat as alive; refusing to start
    // is the safe default there, not silently stepping on it.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function readLockPid(lockPath: string): number | null {
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Acquires the lock or throws a loud, actionable error — never silently
 * proceeds. Call once, at startup, before opening the FIFO itself.
 */
export function acquireFifoLock(fifoPath: string): FifoLock {
  const lockPath = `${fifoPath}.lock`;

  function tryCreate(): number {
    return openSync(lockPath, "wx");
  }

  let fd: number;
  try {
    fd = tryCreate();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

    const existingPid = readLockPid(lockPath);
    if (existingPid !== null && isPidAlive(existingPid)) {
      throw new Error(
        `another uat-driver process (pid ${existingPid}) already holds the lock on "${fifoPath}" ` +
          `(${lockPath}). Concurrent writers to the same FIFO route commands nondeterministically — ` +
          `use a different --fifo path per session, or stop that process first.`,
      );
    }

    // Stale lock (process no longer alive, or the pid file was unreadable/
    // corrupt) — reclaim it. Not a TOCTOU race against another live
    // process: EEXIST above already proved no one else can be mid-`wx`
    // create right now, so unlinking and recreating here is safe.
    process.stderr.write(
      `[uat-driver] reclaiming stale lock at ${lockPath}` +
        (existingPid !== null ? ` (pid ${existingPid} is no longer running)` : " (unreadable pid)") +
        "\n",
    );
    unlinkSync(lockPath);
    fd = tryCreate();
  }

  writeSync(fd, String(process.pid));
  closeSync(fd);

  let released = false;
  return {
    release(): void {
      if (released) return;
      released = true;
      try {
        // Only remove it if it's still ours — a lock we no longer hold
        // (already reclaimed by someone else, somehow) must never be
        // deleted out from under its new owner.
        if (readLockPid(lockPath) === process.pid) unlinkSync(lockPath);
      } catch {
        // Already gone — nothing to clean up.
      }
    },
  };
}
