import type { FastifyRequest } from "fastify";
import {
  hashToken,
  withTenantContext,
  findActiveApiTokenByHash,
  findActiveSessionByHash,
  getSite,
  type Pool,
} from "@prefab/db";
import { forbidden, unauthorized } from "../errors.js";

export const SESSION_COOKIE = "prefab_session";

export type Principal =
  | { kind: "apiToken"; accountId: string; siteId: string }
  | { kind: "session"; accountId: string };

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
 * scoped tokens); a browser session may touch any site its account owns,
 * checked via the same `sites_owner_access` RLS policy the query itself
 * relies on downstream (ADR-0008).
 */
export async function authorizeSite(
  pool: Pool,
  principal: Principal,
  requestedSiteId: string,
): Promise<{ siteId: string; accountId: string }> {
  if (principal.kind === "apiToken") {
    if (principal.siteId !== requestedSiteId) {
      throw forbidden("this token is not scoped to the requested site");
    }
    return { siteId: principal.siteId, accountId: principal.accountId };
  }

  const site = await withTenantContext(pool, { accountId: principal.accountId }, (client) =>
    getSite(client, requestedSiteId),
  );
  if (!site || site.ownerId !== principal.accountId) {
    throw forbidden("not the owner of this site");
  }
  return { siteId: requestedSiteId, accountId: principal.accountId };
}
