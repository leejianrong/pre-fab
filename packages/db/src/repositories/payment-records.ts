import type { PoolClient } from "pg";

export type PaymentRecordStatus = "pending" | "completed" | "failed";

/** A single Checkout session against a Payment block — visitor PII/payment metadata (R20), platform Postgres only, never in a site source tree. Mirrors submissions.ts/bookings.ts's shape. */
export interface PaymentRecord {
  id: string;
  siteId: string;
  blockId: string;
  stripeSessionId: string;
  stripePaymentIntentId: string | null;
  /** Cents. */
  amount: number;
  currency: string;
  status: PaymentRecordStatus;
  buyerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawPaymentRecordRow {
  id: string;
  site_id: string;
  block_id: string;
  stripe_session_id: string;
  stripe_payment_intent_id: string | null;
  amount: number;
  currency: string;
  status: PaymentRecordStatus;
  buyer_email: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToPaymentRecord(row: RawPaymentRecordRow): PaymentRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    blockId: row.block_id,
    stripeSessionId: row.stripe_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    buyerEmail: row.buyer_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreatePaymentRecordInput {
  id: string;
  siteId: string;
  blockId: string;
  stripeSessionId: string;
  amount: number;
  currency: string;
}

/** The one write the runtime checkout endpoint makes once Stripe hands back a session — created 'pending', same "unconditional once validation passes" discipline as createSubmission/BookingStore.create. */
export async function createPaymentRecord(client: PoolClient, input: CreatePaymentRecordInput): Promise<PaymentRecord> {
  const result = await client.query<RawPaymentRecordRow>(
    `INSERT INTO payment_records (id, site_id, block_id, stripe_session_id, amount, currency)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.id, input.siteId, input.blockId, input.stripeSessionId, input.amount, input.currency],
  );
  return rowToPaymentRecord(result.rows[0]!);
}

/** Resolved by the runtime checkout endpoint's own dependency lookup and by dev-advance/the real webhook, both of which already know siteId (dev-advance from its own URL, the real webhook from Checkout's own client_reference_id/metadata — see tenant-stripe-provider.ts) before ever touching this table (R20 / RLS). */
export async function getPaymentRecordBySessionId(client: PoolClient, siteId: string, stripeSessionId: string): Promise<PaymentRecord | null> {
  const result = await client.query<RawPaymentRecordRow>(`SELECT * FROM payment_records WHERE site_id = $1 AND stripe_session_id = $2`, [
    siteId,
    stripeSessionId,
  ]);
  return result.rows[0] ? rowToPaymentRecord(result.rows[0]) : null;
}

/**
 * Marks a session's outcome once Checkout completes (webhook or dev-advance).
 * `AND status = 'pending'` guards the *caller's* idempotency, not just the
 * data's: Stripe retries webhooks it didn't get a fast 2xx for, and without
 * this the row update is harmless (same values re-set) but the webhook
 * route's owner-notification email would fire again on every retry. Scoping
 * the transition to pending -> anything else means a replay after the first
 * successful transition returns no row, so app.ts's `if (updated)` guard
 * naturally skips the duplicate notification too.
 */
export async function updatePaymentRecordStatus(
  client: PoolClient,
  siteId: string,
  stripeSessionId: string,
  patch: { status: PaymentRecordStatus; stripePaymentIntentId?: string | null; buyerEmail?: string | null },
): Promise<PaymentRecord | null> {
  const result = await client.query<RawPaymentRecordRow>(
    `UPDATE payment_records SET
       status = $1,
       stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
       buyer_email = COALESCE($3, buyer_email),
       updated_at = now()
     WHERE site_id = $4 AND stripe_session_id = $5 AND status = 'pending'
     RETURNING *`,
    [patch.status, patch.stripePaymentIntentId ?? null, patch.buyerEmail ?? null, siteId, stripeSessionId],
  );
  return result.rows[0] ? rowToPaymentRecord(result.rows[0]) : null;
}

export interface ListPaymentRecordsOptions {
  /** Clamped to [1, 200]. Default 50. */
  limit?: number;
  /** Clamped to >= 0. Default 0. */
  offset?: number;
}

export interface ListPaymentRecordsResult {
  records: PaymentRecord[];
  total: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** The owner-facing dashboard read — mirrors listSubmissions exactly. */
export async function listPaymentRecordsForSite(
  client: PoolClient,
  siteId: string,
  blockId: string,
  options: ListPaymentRecordsOptions = {},
): Promise<ListPaymentRecordsResult> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));

  const countResult = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM payment_records WHERE site_id = $1 AND block_id = $2`,
    [siteId, blockId],
  );
  const rowsResult = await client.query<RawPaymentRecordRow>(
    `SELECT * FROM payment_records WHERE site_id = $1 AND block_id = $2 ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
    [siteId, blockId, limit, offset],
  );

  return { records: rowsResult.rows.map(rowToPaymentRecord), total: Number(countResult.rows[0]!.count) };
}
