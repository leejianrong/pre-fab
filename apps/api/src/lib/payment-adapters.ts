import {
  createPaymentRecord as dbCreatePaymentRecord,
  getPaymentBlockPublic,
  getStripeConnection,
  withTenantContext,
  type Pool,
} from "@prefab/db";
import type { PaymentBlockStore, PaymentRecordStore, StripeConnectionStore } from "@prefab/runtime";

/**
 * The Postgres-backed halves of @prefab/runtime's Slice 10 storage
 * interfaces (ADR-0010) — apps/api is the control plane, so it's the one
 * place allowed to know these are backed by Postgres/@prefab/db at all.
 * Mirrors booking-adapters.ts exactly.
 */
export function createPostgresPaymentBlockStore(pool: Pool): PaymentBlockStore {
  return {
    async getBlock(blockId) {
      const block = await withTenantContext(pool, {}, (client) => getPaymentBlockPublic(client, blockId));
      if (!block) return null;
      return {
        id: block.id,
        siteId: block.siteId,
        heading: block.heading,
        description: block.description,
        buttonLabel: block.buttonLabel,
        amount: block.amount,
        currency: block.currency,
        successMessage: block.successMessage,
      };
    },
  };
}

export function createPostgresStripeConnectionStore(pool: Pool): StripeConnectionStore {
  return {
    async getConnection(siteId) {
      const connection = await withTenantContext(pool, { siteId }, (client) => getStripeConnection(client, siteId));
      if (!connection) return null;
      return { stripeAccountId: connection.stripeAccountId, accessToken: connection.accessToken, status: connection.status };
    },
  };
}

export function createPostgresPaymentRecordStore(pool: Pool): PaymentRecordStore {
  return {
    async create(input) {
      const record = await withTenantContext(pool, { siteId: input.siteId }, (client) => dbCreatePaymentRecord(client, input));
      return { id: record.id };
    },
  };
}
