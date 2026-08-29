import { attemptWebhookDelivery, buildWebhookPayload, nextDeliveryState, type WebhookPayload, type WebhookQueue } from "@prefab/runtime";
import type { SelfHostDb } from "../db.js";

interface WebhookDeliveryRow {
  id: string;
  url: string;
  secret: string | null;
  payload_json: string;
  attempt: number;
}

/**
 * SQLite-backed WebhookQueue (ADR-0010) — same "attempt immediately,
 * persist the outcome, let a periodic sweep pick up retries" shape as
 * apps/api/src/lib/webhooks.ts's Postgres-backed one (this repo has no
 * background job queue anywhere yet), reimplemented against SQLite rather
 * than depending on that control-plane module.
 */
export function createSqliteWebhookQueue(db: SelfHostDb, fetchImpl: typeof fetch = fetch): WebhookQueue {
  return {
    async enqueue(input) {
      const payload = buildWebhookPayload(input);
      const id = `${input.submissionId}-webhook`;
      db.prepare(
        "INSERT INTO webhook_deliveries (id, site_id, submission_id, url, secret, payload_json, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(id, input.siteId, input.submissionId, input.url, input.webhookSecret, JSON.stringify(payload), new Date().toISOString());

      await attemptAndRecord(db, fetchImpl, { id, url: input.url, secret: input.webhookSecret, payload_json: JSON.stringify(payload), attempt: 0 });
    },
  };
}

async function attemptAndRecord(db: SelfHostDb, fetchImpl: typeof fetch, delivery: WebhookDeliveryRow): Promise<void> {
  const payload = JSON.parse(delivery.payload_json) as WebhookPayload;
  const outcome = await attemptWebhookDelivery(delivery.url, payload, delivery.secret, fetchImpl);
  const attempt = delivery.attempt + 1;

  if (outcome.success) {
    db.prepare("UPDATE webhook_deliveries SET status = 'success', attempt = ?, last_error = NULL, delivered_at = ? WHERE id = ?").run(
      attempt,
      new Date().toISOString(),
      delivery.id,
    );
    return;
  }

  const next = nextDeliveryState(attempt);
  db.prepare("UPDATE webhook_deliveries SET status = ?, attempt = ?, last_error = ?, next_attempt_at = ? WHERE id = ?").run(
    next.status,
    attempt,
    outcome.error ?? null,
    next.nextAttemptAt.toISOString(),
    delivery.id,
  );
}

/**
 * Retries every due delivery. Called opportunistically after each new
 * submission (same as apps/api's own `retryDueWebhookDeliveries`), and on a
 * periodic timer from server.ts so a delivery still retries even on a
 * quiet instance with no new traffic.
 */
export async function retryDueWebhookDeliveries(db: SelfHostDb, fetchImpl: typeof fetch = fetch): Promise<number> {
  const due = db
    .prepare<[string], WebhookDeliveryRow>(
      "SELECT id, url, secret, payload_json, attempt FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= ?",
    )
    .all(new Date().toISOString());
  for (const delivery of due) {
    await attemptAndRecord(db, fetchImpl, delivery);
  }
  return due.length;
}
