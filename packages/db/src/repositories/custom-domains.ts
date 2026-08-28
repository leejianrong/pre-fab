import type { PoolClient } from "pg";

export type CustomDomainStatus = "pending_dns" | "active" | "failed";

export interface CustomDomain {
  id: string;
  siteId: string;
  hostname: string;
  isApex: boolean;
  status: CustomDomainStatus;
  providerHostnameId: string | null;
  cnameTarget: string;
  verificationError: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

interface RawCustomDomainRow {
  id: string;
  site_id: string;
  hostname: string;
  is_apex: boolean;
  status: CustomDomainStatus;
  provider_hostname_id: string | null;
  cname_target: string;
  verification_error: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

function rowToCustomDomain(row: RawCustomDomainRow): CustomDomain {
  return {
    id: row.id,
    siteId: row.site_id,
    hostname: row.hostname,
    isApex: row.is_apex,
    status: row.status,
    providerHostnameId: row.provider_hostname_id,
    cnameTarget: row.cname_target,
    verificationError: row.verification_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

export async function createCustomDomain(
  client: PoolClient,
  input: {
    id: string;
    siteId: string;
    hostname: string;
    isApex: boolean;
    providerHostnameId: string | null;
    cnameTarget: string;
    createdBy: string;
  },
): Promise<CustomDomain> {
  const result = await client.query<RawCustomDomainRow>(
    `INSERT INTO custom_domains (id, site_id, hostname, is_apex, provider_hostname_id, cname_target, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [input.id, input.siteId, input.hostname, input.isApex, input.providerHostnameId, input.cnameTarget, input.createdBy],
  );
  return rowToCustomDomain(result.rows[0]!);
}

export async function getCustomDomain(client: PoolClient, siteId: string, domainId: string): Promise<CustomDomain | null> {
  const result = await client.query<RawCustomDomainRow>(`SELECT * FROM custom_domains WHERE site_id = $1 AND id = $2`, [
    siteId,
    domainId,
  ]);
  return result.rows[0] ? rowToCustomDomain(result.rows[0]) : null;
}

export async function listCustomDomainsForSite(client: PoolClient, siteId: string): Promise<CustomDomain[]> {
  const result = await client.query<RawCustomDomainRow>(
    `SELECT * FROM custom_domains WHERE site_id = $1 ORDER BY created_at`,
    [siteId],
  );
  return result.rows.map(rowToCustomDomain);
}

export async function updateCustomDomainStatus(
  client: PoolClient,
  domainId: string,
  input: { status: CustomDomainStatus; verificationError: string | null },
): Promise<CustomDomain> {
  const result = await client.query<RawCustomDomainRow>(
    `UPDATE custom_domains SET status = $1, verification_error = $2, updated_at = now() WHERE id = $3 RETURNING *`,
    [input.status, input.verificationError, domainId],
  );
  if (!result.rows[0]) throw new Error(`custom domain ${domainId} not found`);
  return rowToCustomDomain(result.rows[0]);
}

export async function deleteCustomDomain(client: PoolClient, siteId: string, domainId: string): Promise<void> {
  await client.query(`DELETE FROM custom_domains WHERE site_id = $1 AND id = $2`, [siteId, domainId]);
}

/**
 * The public routing path: given only a Host header, no site_id is known
 * yet — this relies on `custom_domains_public_active_read`'s RLS policy
 * (active rows only, SELECT only), not on any tenant context being set.
 * Call with `withTenantContext(pool, {})` (no siteId/accountId).
 */
export async function findActiveCustomDomainByHostname(client: PoolClient, hostname: string): Promise<CustomDomain | null> {
  const result = await client.query<RawCustomDomainRow>(
    `SELECT * FROM custom_domains WHERE hostname = $1 AND status = 'active'`,
    [hostname],
  );
  return result.rows[0] ? rowToCustomDomain(result.rows[0]) : null;
}
