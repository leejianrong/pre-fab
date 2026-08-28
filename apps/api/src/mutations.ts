/**
 * The single source of truth for "every mutation exposed by the HTTP API"
 * (R12 / ADR-0003). src/app.ts registers each route FROM this list rather
 * than the list describing routes registered elsewhere, so the manifest and
 * reality cannot drift. tools/checks' parity script imports this module —
 * and only this module, no fastify/db — to check @prefab/commands covers
 * every entry, without booting a server or a database.
 */
export const API_MUTATIONS = [
  { name: "account.signup", method: "POST", path: "/v1/signup" },
  { name: "account.verifyEmail", method: "POST", path: "/v1/signup/verify" },
  { name: "site.create", method: "POST", path: "/v1/sites" },
  { name: "site.createFromTemplate", method: "POST", path: "/v1/templates/:templateId/use" },
  { name: "theme.update", method: "PUT", path: "/v1/sites/:siteId/theme" },
  { name: "page.create", method: "POST", path: "/v1/sites/:siteId/pages" },
  { name: "page.write", method: "PUT", path: "/v1/sites/:siteId/pages/:pageId" },
  { name: "asset.upload", method: "POST", path: "/v1/sites/:siteId/assets" },
  { name: "token.create", method: "POST", path: "/v1/sites/:siteId/tokens" },
  { name: "domain.add", method: "POST", path: "/v1/sites/:siteId/domains" },
  { name: "domain.verify", method: "POST", path: "/v1/sites/:siteId/domains/:domainId/verify" },
  { name: "domain.remove", method: "DELETE", path: "/v1/sites/:siteId/domains/:domainId" },
  { name: "publish.create", method: "POST", path: "/v1/sites/:siteId/publish" },
  { name: "publish.rollback", method: "POST", path: "/v1/sites/:siteId/publishes/:publishId/rollback" },
] as const;

export type MutationName = (typeof API_MUTATIONS)[number]["name"];
