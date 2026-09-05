export interface ConcurrencyGateOptions {
  /** Maximum number of tasks allowed to run at once. Floored, and clamped to at least 1 — a gate that let `limit` reach 0 would wedge forever. */
  limit: number;
}

export interface ConcurrencyGate {
  /** Tasks currently executing (not waiting). Always `<= limit`. */
  readonly active: number;
  /** Tasks queued FIFO, waiting for a slot to free up. */
  readonly pending: number;
  /**
   * Runs `fn` once a slot is available, queueing behind any earlier callers
   * still waiting if all slots are taken. Resolves/rejects with whatever
   * `fn` resolves/rejects with; a rejection frees the slot exactly like a
   * resolution does; it never blocks tasks queued behind it (fixed by
   * releasing the slot in a `finally`, not after a successful return).
   */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * A bounded, in-memory, per-process FIFO concurrency gate (KAN-1153). Not a
 * rate limiter (packages/runtime's `createInMemoryRateLimiter` counts
 * requests per time window and rejects the excess); this counts *concurrent*
 * work and queues the excess instead of rejecting it — the two are
 * complementary, not overlapping, concerns.
 *
 * Deliberately hand-rolled rather than a dependency (no `p-limit`/`p-queue`
 * already lives in this monorepo, and the primitive is small): a waiter is
 * just a promise executor pushed onto an array, released FIFO as slots free
 * up.
 */
export function createConcurrencyGate(options: ConcurrencyGateOptions): ConcurrencyGate {
  const limit = Math.max(1, Math.floor(options.limit));
  let active = 0;
  const queue: Array<() => void> = [];

  function admitNext(): void {
    if (active >= limit) return;
    const admit = queue.shift();
    if (!admit) return;
    active += 1;
    admit();
  }

  return {
    get active() {
      return active;
    },
    get pending() {
      return queue.length;
    },
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
        admitNext();
      });
      try {
        return await fn();
      } finally {
        active -= 1;
        admitNext();
      }
    },
  };
}
