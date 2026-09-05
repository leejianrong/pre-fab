import type { PoolClient } from "pg";

export type StripeConnectionStatus = "connected" | "error";

/** A site owner's own connected Stripe account (ADR-0005, KAN-1137) — mirrors calendar-connections.ts's shape exactly, minus the refresh token/expiry pair a Stripe Standard OAuth access token has no use for (see 0009_slice10_payments.sql's header comment). */
export interface StripeConnection {
  id: string;
  siteId: string;
  stripeAccountId: string;
  accessToken: string;
  status: StripeConnectionStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface RawStripeConnectionRow {
  id: string;
  site_id: string;
  stripe_account_id: string;
  access_token: string;
  status: StripeConnectionStatus;
  created_at: Date;
  updated_at: Date;
}

function rowToStripeConnection(row: RawStripeConnectionRow): StripeConnection {
  return {
    id: row.id,
    siteId: row.site_id,
    stripeAccountId: row.stripe_account_id,
    accessToken: row.access_token,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateStripeConnectionInput {
  id: string;
  siteId: string;
  stripeAccountId: string;
  accessToken: string;
}

/** stripe.connect (owner-authenticated mutation) — one connection per site, whole-row replace, same shape as upsertCalendarConnection. */
export async function createStripeConnection(client: PoolClient, input: CreateStripeConnectionInput): Promise<StripeConnection> {
  const result = await client.query<RawStripeConnectionRow>(
    `INSERT INTO stripe_connections (id, site_id, stripe_account_id, access_token)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (site_id) DO UPDATE SET
       stripe_account_id = EXCLUDED.stripe_account_id,
       access_token = EXCLUDED.access_token,
       status = 'connected',
       updated_at = now()
     RETURNING *`,
    [input.id, input.siteId, input.stripeAccountId, input.accessToken],
  );
  return rowToStripeConnection(result.rows[0]!);
}

export async function getStripeConnection(client: PoolClient, siteId: string): Promise<StripeConnection | null> {
  const result = await client.query<RawStripeConnectionRow>(`SELECT * FROM stripe_connections WHERE site_id = $1`, [siteId]);
  return result.rows[0] ? rowToStripeConnection(result.rows[0]) : null;
}

export async function deleteStripeConnection(client: PoolClient, siteId: string): Promise<void> {
  await client.query(`DELETE FROM stripe_connections WHERE site_id = $1`, [siteId]);
}
