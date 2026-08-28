import {
  createWebhookDelivery,
  listDueWebhookDeliveries,
  recordWebhookAttempt,
  withTenantContext,
  type Pool,
} from "@prefab/db";
import { attemptWebhookDelivery, buildWebhookPayload, nextDeliveryState, type WebhookPayload, type WebhookQueue } from "@prefab/runtime";
import { newUlid } from "@prefab/schema";

/**
 * @prefab/runtime's WebhookQueue, backed by Postgres. "Enqueue" writes a
 * `pending` row and, since this repo has no background job queue yet (the
 * same constraint custom_domains' DNS polling already documents), attempts
 * delivery immediately inline — `retryDueWebhookDeliveries` below is what
 * picks up anything that failed, called opportunistically (see app.ts) so
 * a failed delivery still gets retried without a real scheduler.
 */
export function createPostgresWebhookQueue(pool: Pool, fetchImpl: typeof fetch = fetch): WebhookQueue {
  return {
    async enqueue(input) {
      const payload = buildWebhookPayload(input);
      const delivery = await withTenantContext(pool, { siteId: input.siteId }, (client) =>
        createWebhookDelivery(client, {
          id: newUlid(),
          siteId: input.siteId,
          submissionId: input.submissionId,
          url: input.url,
          secret: input.webhookSecret,
          payload: payload as unknown as Record<string, unknown>,
        }),
      );
      await attemptDelivery(pool, input.siteId, delivery.id, input.url, payload, input.webhookSecret, fetchImpl);
    },
  };
}

async function attemptDelivery(
  pool: Pool,
  siteId: string,
  deliveryId: string,
  url: string,
  payload: WebhookPayload,
  secret: string | null,
  fetchImpl: typeof fetch,
): Promise<void> {
  const outcome = await attemptWebhookDelivery(url, payload, secret, fetchImpl);
  const attempt = await withTenantContext(pool, { siteId }, async (client) => {
    if (outcome.success) {
      return recordWebhookAttempt(client, deliveryId, {
        status: "success",
        attempt: 1,
        lastError: null,
        nextAttemptAt: new Date(),
        deliveredAt: new Date(),
      });
    }
    const next = nextDeliveryState(1);
    return recordWebhookAttempt(client, deliveryId, {
      status: next.status,
      attempt: 1,
      lastError: outcome.error ?? null,
      nextAttemptAt: next.nextAttemptAt,
      deliveredAt: null,
    });
  });
  void attempt;
}

/**
 * Retries every due delivery for one site (scoped — see WebhookQueue's own
 * comment on why there is no cross-tenant sweep). Called opportunistically
 * at the top of every new submission for the same site, and reachable
 * directly for tests via the dev-only `/v1/dev/webhooks/retry` endpoint.
 */
export async function retryDueWebhookDeliveries(pool: Pool, siteId: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  const due = await withTenantContext(pool, { siteId }, (client) => listDueWebhookDeliveries(client, siteId));
  for (const delivery of due) {
    const outcome = await attemptWebhookDelivery(
      delivery.url,
      delivery.payload as unknown as WebhookPayload,
      delivery.secret,
      fetchImpl,
    );
    const nextAttempt = delivery.attempt + 1;
    await withTenantContext(pool, { siteId }, (client) => {
      if (outcome.success) {
        return recordWebhookAttempt(client, delivery.id, {
          status: "success",
          attempt: nextAttempt,
          lastError: null,
          nextAttemptAt: new Date(),
          deliveredAt: new Date(),
        });
      }
      const next = nextDeliveryState(nextAttempt);
      return recordWebhookAttempt(client, delivery.id, {
        status: next.status,
        attempt: nextAttempt,
        lastError: outcome.error ?? null,
        nextAttemptAt: next.nextAttemptAt,
        deliveredAt: null,
      });
    });
  }
  return due.length;
}
