export interface RateLimitResult {
  allowed: boolean;
  /** Present only when `allowed` is false. */
  retryAfterMs?: number;
}

export interface RateLimiter {
  consume(key: string): RateLimitResult;
}

interface Window {
  count: number;
  windowStart: number;
}

/**
 * Fixed-window counter, in-memory. Deliberately not persisted: this repo
 * has no shared cache/queue yet (the same constraint custom_domains'
 * lazy DNS polling already documents), and a per-process window is enough
 * to blunt a naive flood without pretending to be a distributed limiter.
 * Self-host (Slice 7) gets exactly this same behaviour for free — a
 * single-process deployment has no cross-process window to lose.
 */
export function createInMemoryRateLimiter(input: { limit: number; windowMs: number }): RateLimiter {
  const { limit, windowMs } = input;
  const windows = new Map<string, Window>();

  return {
    consume(key: string): RateLimitResult {
      const now = Date.now();
      const existing = windows.get(key);

      if (!existing || now - existing.windowStart >= windowMs) {
        windows.set(key, { count: 1, windowStart: now });
        return { allowed: true };
      }

      if (existing.count < limit) {
        existing.count += 1;
        return { allowed: true };
      }

      return { allowed: false, retryAfterMs: windowMs - (now - existing.windowStart) };
    },
  };
}
