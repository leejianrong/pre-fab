import { describe, expect, it, vi } from "vitest";
import { createInMemoryRateLimiter } from "../src/rate-limit.js";

describe("createInMemoryRateLimiter", () => {
  it("allows up to the limit within a window, then rejects", () => {
    const limiter = createInMemoryRateLimiter({ limit: 3, windowMs: 60_000 });
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(true);
    const fourth = limiter.consume("a");
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    const limiter = createInMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("b").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
  });

  it("resets once the window elapses", () => {
    vi.useFakeTimers();
    try {
      const limiter = createInMemoryRateLimiter({ limit: 1, windowMs: 1000 });
      expect(limiter.consume("a").allowed).toBe(true);
      expect(limiter.consume("a").allowed).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(limiter.consume("a").allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
