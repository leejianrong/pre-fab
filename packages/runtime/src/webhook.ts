export interface WebhookPayload {
  event: "form.submission.created";
  formId: string;
  submissionId: string;
  values: Record<string, unknown>;
  createdAt: string;
}

export function buildWebhookPayload(input: {
  formId: string;
  submissionId: string;
  values: Record<string, unknown>;
  createdAt: string;
}): WebhookPayload {
  return {
    event: "form.submission.created",
    formId: input.formId,
    submissionId: input.submissionId,
    values: input.values,
    createdAt: input.createdAt,
  };
}

/** After this many attempts a delivery is marked permanently `failed` rather than rescheduled again. */
export const MAX_WEBHOOK_ATTEMPTS = 6;

const BASE_DELAY_MS = 30_000; // 30s
const MAX_DELAY_MS = 60 * 60_000; // 1h

/** Exponential backoff, doubling from a 30s base and capped at 1h — attempt is 1-indexed (the attempt number that just ran). */
export function computeBackoffMs(attempt: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
}

export interface WebhookDeliveryOutcome {
  success: boolean;
  status?: number;
  error?: string;
}

export type WebhookFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
}>;

/** One HTTP attempt. Any 2xx is success; anything else (including a thrown network error) is a retryable failure. */
export async function attemptWebhookDelivery(
  url: string,
  payload: WebhookPayload,
  secret: string | null,
  fetchImpl: WebhookFetch,
): Promise<WebhookDeliveryOutcome> {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (secret) headers["x-prefab-webhook-secret"] = secret;
    const response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(payload) });
    if (response.ok) return { success: true, status: response.status };
    return { success: false, status: response.status, error: `webhook endpoint responded ${response.status}` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface NextDeliveryState {
  status: "pending" | "failed";
  nextAttemptAt: Date;
}

/** Given the attempt that just ran, decide whether to retry (with backoff) or give up. `now` is injectable for tests. */
export function nextDeliveryState(attempt: number, now: Date = new Date()): NextDeliveryState {
  if (attempt >= MAX_WEBHOOK_ATTEMPTS) {
    return { status: "failed", nextAttemptAt: now };
  }
  return { status: "pending", nextAttemptAt: new Date(now.getTime() + computeBackoffMs(attempt)) };
}
