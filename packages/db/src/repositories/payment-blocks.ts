import type { PoolClient } from "pg";

/** The publish-safe manifest a Payment block's props are snapshotted into on every publish — mirrors @prefab/db's booking-widgets.ts exactly, see 0009_slice10_payments.sql's header comment for why. */
export interface PaymentBlock {
  id: string;
  siteId: string;
  heading: string;
  description: string;
  buttonLabel: string;
  /** Cents. */
  amount: number;
  currency: string;
  successMessage: string;
  createdAt: Date;
  updatedAt: Date;
}

interface RawPaymentBlockRow {
  id: string;
  site_id: string;
  heading: string;
  description: string;
  button_label: string;
  amount: number;
  currency: string;
  success_message: string;
  created_at: Date;
  updated_at: Date;
}

function rowToPaymentBlock(row: RawPaymentBlockRow): PaymentBlock {
  return {
    id: row.id,
    siteId: row.site_id,
    heading: row.heading,
    description: row.description,
    buttonLabel: row.button_label,
    amount: row.amount,
    currency: row.currency,
    successMessage: row.success_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Called by the publish pipeline for every Payment block on every published page — mirrors upsertPublishedBookingWidget exactly. */
export async function upsertPublishedPaymentBlock(
  client: PoolClient,
  input: { id: string; siteId: string; heading: string; description: string; buttonLabel: string; amount: number; currency: string; successMessage: string },
): Promise<PaymentBlock> {
  const result = await client.query<RawPaymentBlockRow>(
    `INSERT INTO payment_blocks (id, site_id, heading, description, button_label, amount, currency, success_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       heading = EXCLUDED.heading,
       description = EXCLUDED.description,
       button_label = EXCLUDED.button_label,
       amount = EXCLUDED.amount,
       currency = EXCLUDED.currency,
       success_message = EXCLUDED.success_message,
       updated_at = now()
     RETURNING *`,
    [input.id, input.siteId, input.heading, input.description, input.buttonLabel, input.amount, input.currency, input.successMessage],
  );
  return rowToPaymentBlock(result.rows[0]!);
}

/** The runtime's only way to resolve a blockId with no tenant context — relies entirely on `payment_blocks_public_read`. Call with `withTenantContext(pool, {})`. */
export async function getPaymentBlockPublic(client: PoolClient, blockId: string): Promise<PaymentBlock | null> {
  const result = await client.query<RawPaymentBlockRow>(`SELECT * FROM payment_blocks WHERE id = $1`, [blockId]);
  return result.rows[0] ? rowToPaymentBlock(result.rows[0]) : null;
}

export async function getPaymentBlock(client: PoolClient, siteId: string, blockId: string): Promise<PaymentBlock | null> {
  const result = await client.query<RawPaymentBlockRow>(`SELECT * FROM payment_blocks WHERE site_id = $1 AND id = $2`, [
    siteId,
    blockId,
  ]);
  return result.rows[0] ? rowToPaymentBlock(result.rows[0]) : null;
}
