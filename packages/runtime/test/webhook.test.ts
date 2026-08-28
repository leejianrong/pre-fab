import { describe, expect, it } from "vitest";
import { attemptWebhookDelivery, buildWebhookPayload, computeBackoffMs, nextDeliveryState, MAX_WEBHOOK_ATTEMPTS } from "../src/webhook.js";

describe("computeBackoffMs", () => {
  it("doubles from a 30s base", () => {
    expect(computeBackoffMs(1)).toBe(30_000);
    expect(computeBackoffMs(2)).toBe(60_000);
    expect(computeBackoffMs(3)).toBe(120_000);
  });

  it("caps at 1 hour", () => {
    expect(computeBackoffMs(20)).toBe(60 * 60_000);
  });
});

describe("nextDeliveryState", () => {
  it("schedules a retry with backoff before the attempt cap", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const state = nextDeliveryState(1, now);
    expect(state.status).toBe("pending");
    expect(state.nextAttemptAt.getTime()).toBe(now.getTime() + 30_000);
  });

  it("gives up permanently once the attempt cap is reached", () => {
    const state = nextDeliveryState(MAX_WEBHOOK_ATTEMPTS);
    expect(state.status).toBe("failed");
  });
});

describe("attemptWebhookDelivery", () => {
  const payload = buildWebhookPayload({ formId: "f1", submissionId: "s1", values: { email: "a@example.com" }, createdAt: "2026-01-01T00:00:00Z" });

  it("succeeds on a 2xx response and signs the payload when a secret is set", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchImpl = async (_url: string, init: { headers: Record<string, string>; body: string }) => {
      capturedHeaders = init.headers;
      return { ok: true, status: 200 };
    };
    const result = await attemptWebhookDelivery("https://example.com/hook", payload, "shh", fetchImpl);
    expect(result.success).toBe(true);
    expect(capturedHeaders?.["x-prefab-webhook-secret"]).toBe("shh");
  });

  it("fails on a non-2xx response", async () => {
    const fetchImpl = async () => ({ ok: false, status: 500 });
    const result = await attemptWebhookDelivery("https://example.com/hook", payload, null, fetchImpl);
    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
  });

  it("fails, capturing the error, when the endpoint is unreachable", async () => {
    const fetchImpl = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const result = await attemptWebhookDelivery("https://example.invalid/hook", payload, null, fetchImpl);
    expect(result.success).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });
});
