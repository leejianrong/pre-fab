import type { PoolClient } from "pg";

export type SiteRole = "owner" | "editor" | "viewer";

export interface SiteMember {
  siteId: string;
  accountId: string;
  role: SiteRole;
  createdAt: Date;
}

interface SiteMemberRow {
  site_id: string;
  account_id: string;
  role: SiteRole;
  created_at: Date;
}

function rowToMember(row: SiteMemberRow): SiteMember {
  return { siteId: row.site_id, accountId: row.account_id, role: row.role, createdAt: row.created_at };
}

/** Called in the same transaction as site creation (site.create / site.createFromTemplate) so the creator's `owner` row exists from the first moment the site does. */
export async function addSiteMember(
  client: PoolClient,
  input: { siteId: string; accountId: string; role: SiteRole },
): Promise<SiteMember> {
  const result = await client.query<SiteMemberRow>(
    `INSERT INTO site_members (site_id, account_id, role) VALUES ($1, $2, $3) RETURNING *`,
    [input.siteId, input.accountId, input.role],
  );
  return rowToMember(result.rows[0]!);
}

/**
 * The single source of truth authorizeSite calls to resolve a principal's
 * access — null means "not a member of this site," collapsed by the
 * caller into the same 403 a nonexistent site would produce, exactly like
 * the strict-ownership check it replaces (never leaks whether the site
 * exists to an account with no relationship to it).
 */
export async function getSiteMemberRole(client: PoolClient, siteId: string, accountId: string): Promise<SiteRole | null> {
  const result = await client.query<{ role: SiteRole }>(
    `SELECT role FROM site_members WHERE site_id = $1 AND account_id = $2`,
    [siteId, accountId],
  );
  return result.rows[0]?.role ?? null;
}

export async function listSiteMembers(client: PoolClient, siteId: string): Promise<SiteMember[]> {
  const result = await client.query<SiteMemberRow>(
    `SELECT * FROM site_members WHERE site_id = $1 ORDER BY created_at`,
    [siteId],
  );
  return result.rows.map(rowToMember);
}

export async function updateSiteMemberRole(
  client: PoolClient,
  siteId: string,
  accountId: string,
  role: SiteRole,
): Promise<SiteMember | null> {
  const result = await client.query<SiteMemberRow>(
    `UPDATE site_members SET role = $1 WHERE site_id = $2 AND account_id = $3 RETURNING *`,
    [role, siteId, accountId],
  );
  return result.rows[0] ? rowToMember(result.rows[0]) : null;
}

export async function removeSiteMember(client: PoolClient, siteId: string, accountId: string): Promise<void> {
  await client.query(`DELETE FROM site_members WHERE site_id = $1 AND account_id = $2`, [siteId, accountId]);
}
