import type { PoolClient } from "pg";

export type WebhookDeliveryStatus = "pending" | "success" | "failed";

export interface WebhookDelivery {
  id: string;
  siteId: string;
  submissionId: string;
  url: string;
  secret: string | null;
  payload: Record<string, unknown>;
  attempt: number;
  status: WebhookDeliveryStatus;
  lastError: string | null;
  nextAttemptAt: Date;
  createdAt: Date;
  deliveredAt: Date | null;
}

interface RawWebhookDeliveryRow {
  id: string;
  site_id: string;
  submission_id: string;
  url: string;
  secret: string | null;
  payload: Record<string, unknown>;
  attempt: number;
  status: WebhookDeliveryStatus;
  last_error: string | null;
  next_attempt_at: Date;
  created_at: Date;
  delivered_at: Date | null;
}

function rowToWebhookDelivery(row: RawWebhookDeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    siteId: row.site_id,
    submissionId: row.submission_id,
    url: row.url,
    secret: row.secret,
    payload: row.payload,
    attempt: row.attempt,
    status: row.status,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}

export async function createWebhookDelivery(
  client: PoolClient,
  input: { id: string; siteId: string; submissionId: string; url: string; secret: string | null; payload: Record<string, unknown> },
): Promise<WebhookDelivery> {
  const result = await client.query<RawWebhookDeliveryRow>(
    `INSERT INTO webhook_deliveries (id, site_id, submission_id, url, secret, payload) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.id, input.siteId, input.submissionId, input.url, input.secret, JSON.stringify(input.payload)],
  );
  return rowToWebhookDelivery(result.rows[0]!);
}

/**
 * Due retries for one site, oldest first. Scoped to a single tenant
 * context by design — see packages/runtime's webhook module for why
 * there is no cross-tenant sweep (this repo has no background job queue
 * yet, the same constraint custom_domains' DNS polling already documents).
 */
export async function listDueWebhookDeliveries(client: PoolClient, siteId: string, limit = 20): Promise<WebhookDelivery[]> {
  const result = await client.query<RawWebhookDeliveryRow>(
    `SELECT * FROM webhook_deliveries WHERE site_id = $1 AND status = 'pending' AND next_attempt_at <= now()
     ORDER BY next_attempt_at LIMIT $2`,
    [siteId, limit],
  );
  return result.rows.map(rowToWebhookDelivery);
}

export async function recordWebhookAttempt(
  client: PoolClient,
  id: string,
  input: { status: WebhookDeliveryStatus; attempt: number; lastError: string | null; nextAttemptAt: Date; deliveredAt: Date | null },
): Promise<WebhookDelivery> {
  const result = await client.query<RawWebhookDeliveryRow>(
    `UPDATE webhook_deliveries SET status = $1, attempt = $2, last_error = $3, next_attempt_at = $4, delivered_at = $5
     WHERE id = $6 RETURNING *`,
    [input.status, input.attempt, input.lastError, input.nextAttemptAt, input.deliveredAt, id],
  );
  if (!result.rows[0]) throw new Error(`webhook delivery ${id} not found`);
  return rowToWebhookDelivery(result.rows[0]);
}

export async function listWebhookDeliveriesForSubmission(client: PoolClient, siteId: string, submissionId: string): Promise<WebhookDelivery[]> {
  const result = await client.query<RawWebhookDeliveryRow>(
    `SELECT * FROM webhook_deliveries WHERE site_id = $1 AND submission_id = $2 ORDER BY created_at`,
    [siteId, submissionId],
  );
  return result.rows.map(rowToWebhookDelivery);
}
