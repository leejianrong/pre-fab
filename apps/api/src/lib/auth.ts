import type { FastifyRequest } from "fastify";
import {
  hashToken,
  withTenantContext,
  findActiveApiTokenByHash,
  findActiveSessionByHash,
  getSiteMemberRole,
  type Pool,
  type SiteRole,
} from "@prefab/db";
import { forbidden, unauthorized } from "../errors.js";

export const SESSION_COOKIE = "prefab_session";

export type Principal =
  | { kind: "apiToken"; accountId: string; siteId: string }
  | { kind: "session"; accountId: string };

export type { SiteRole };

/** owner > editor > viewer (Slice 8) — the ranking authorizeSite's minRole check compares against. */
const ROLE_RANK: Record<SiteRole, number> = { viewer: 1, editor: 2, owner: 3 };

/**
 * Agents receive no elevated trust: an API token and a browser session are
 * both just a principal by the time a route handler runs (ADR-0001).
 */
export async function resolvePrincipal(pool: Pool, request: FastifyRequest): Promise<Principal> {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const raw = authHeader.slice("Bearer ".length).trim();
    const token = await withTenantContext(pool, {}, (client) =>
      findActiveApiTokenByHash(client, hashToken(raw)),
    );
    if (!token) throw unauthorized("invalid, expired or revoked API token");
    return { kind: "apiToken", accountId: token.accountId, siteId: token.siteId };
  }

  const cookieToken = (request as FastifyRequest & { cookies: Record<string, string | undefined> }).cookies[
    SESSION_COOKIE
  ];
  if (cookieToken) {
    const session = await withTenantContext(pool, {}, (client) =>
      findActiveSessionByHash(client, hashToken(cookieToken)),
    );
    if (!session) throw unauthorized("session expired");
    return { kind: "session", accountId: session.accountId };
  }

  throw unauthorized();
}

/**
 * A token is hard-scoped to the site it was minted for (ADR-0001 — per-site
 * scoped tokens); a browser session may touch any site its account is a
 * member of. Either way, the actual permission check is the same lookup:
 * `site_members` (Slice 8), read under the same RLS tenant-context
 * mechanism every other query uses (ADR-0008) — never a second, separate
 * authorization path. A missing membership row (site doesn't exist, or
 * this account has no relationship to it) and an insufficient role both
 * collapse to the same 403, so neither leaks which case it was — the same
 * discipline the strict-ownership check this replaces already had.
 *
 * `minRole` defaults to "viewer": every read-only route is reachable by any
 * member. Mutating routes pass `{ minRole: "editor" }`, and site-level
 * concerns (custom domains, tokens, member management, billing) pass
 * `{ minRole: "owner" }`.
 */
export async function authorizeSite(
  pool: Pool,
  principal: Principal,
  requestedSiteId: string,
  options: { minRole?: SiteRole } = {},
): Promise<{ siteId: string; accountId: string; role: SiteRole }> {
  const minRole = options.minRole ?? "viewer";

  if (principal.kind === "apiToken" && principal.siteId !== requestedSiteId) {
    throw forbidden("this token is not scoped to the requested site");
  }

  const role = await withTenantContext(pool, { accountId: principal.accountId, siteId: requestedSiteId }, (client) =>
    getSiteMemberRole(client, requestedSiteId, principal.accountId),
  );
  if (!role) throw forbidden("not a member of this site");
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
    throw forbidden(`requires ${minRole} access or higher — this account has ${role} access`);
  }

  return { siteId: requestedSiteId, accountId: principal.accountId, role };
}
