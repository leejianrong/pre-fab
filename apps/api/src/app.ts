import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { z } from "zod";
import {
  hashToken,
  withTenantContext,
  getAccountByEmail,
  createSession,
  createApiToken,
  createSite,
  getSite,
  listSitesForAccount,
  createTheme,
  getTheme,
  updateThemeTokens,
  createPage,
  getPageDocument,
  writePageDocument,
  listPagesForSite,
  createPublish,
  setLivePublish,
  getLivePublish,
  listPublishes,
  type Pool,
  type PoolClient,
  type SiteRow,
} from "@prefab/db";
import {
  DEFAULT_THEME_TOKENS,
  diffPageDocuments,
  newUlid,
  validatePageDocument,
  type PageDocument,
  type SiteManifest,
} from "@prefab/schema";
import { blockSchemaRegistry, HERO_BLOCK_TYPE, heroDefaultProps } from "@prefab/blocks";
import { buildSiteBundle } from "@prefab/publish";
import { ApiError, conflict, forbidden, notFound, unauthorized, validationError } from "./errors.js";
import { API_MUTATIONS } from "./mutations.js";
import { resolvePrincipal, authorizeSite, SESSION_COOKIE, type Principal } from "./lib/auth.js";
import { generateRawToken } from "./lib/tokens.js";
import { buildSiteOutline } from "./lib/outline.js";
import {
  CreatePageBodySchema,
  CreateSiteBodySchema,
  CreateTokenBodySchema,
  DevLoginBodySchema,
  UpdateThemeBodySchema,
  WritePageBodySchema,
} from "./schemas.js";

export interface AppDeps {
  pool: Pool;
  bundleStoreDir: string;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw validationError("invalid request body", result.error.issues);
  }
  return result.data;
}

async function siteManifestFor(client: PoolClient, site: SiteRow): Promise<SiteManifest> {
  const pageRefs = await listPagesForSite(client, site.id);
  return {
    id: site.id,
    slug: site.slug,
    name: site.name,
    ownerId: site.ownerId,
    schemaVersion: site.schemaVersion,
    pages: pageRefs.map((p) => ({ id: p.id, slug: p.slug })),
  };
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { pool, bundleStoreDir } = deps;
  const app = Fastify({ logger: false });

  app.register(cookie);
  // The editor SPA runs on its own Vite dev-server origin (ADR-0004 —
  // Puck lives in a Vite React SPA, never inside Astro) and authenticates
  // via cookie, so credentialed cross-origin requests must be explicitly
  // allowed rather than left to the default same-origin browser behaviour.
  app.register(cors, {
    origin: (process.env.EDITOR_ORIGIN ?? "http://localhost:5173").split(","),
    credentials: true,
  });

  // Unauthenticated on purpose — a readiness probe (e2e's webServer check,
  // container healthchecks) shouldn't need a principal to ask "are you up".
  app.get("/health", async () => ({ ok: true }));

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    app.log.error(error);
    reply.status(500).send({ error: { code: "internal", message: "internal error" } });
  });

  async function requirePrincipal(request: FastifyRequest): Promise<Principal> {
    return resolvePrincipal(pool, request);
  }

  // ---- Dev-only bootstrap (not a product mutation, not in API_MUTATIONS) ----
  // Slice 1 has no signup UI (SLICES.md) — this is how a seeded account gets
  // a browser session. Slice 3 replaces it with real signup.
  app.post("/v1/dev/login", async (request, reply) => {
    const body = parseBody(DevLoginBodySchema, request.body);
    const account = await withTenantContext(pool, {}, (client) => getAccountByEmail(client, body.email));
    if (!account) throw unauthorized("no account with that email — accounts are seeded in slice 1");

    const raw = generateRawToken();
    const session = await withTenantContext(pool, {}, (client) =>
      createSession(client, {
        id: newUlid(),
        accountId: account.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }),
    );
    reply.setCookie(SESSION_COOKIE, raw, { path: "/", httpOnly: true, expires: session.expiresAt });
    return { accountId: account.id };
  });

  // ---- site.create ----
  app.post("/v1/sites", async (request) => {
    const principal = await requirePrincipal(request);
    if (principal.kind !== "session") throw forbidden("sites are created from a signed-in session, not an API token");
    const body = parseBody(CreateSiteBodySchema, request.body);
    // Pre-mint the id so both RLS policies on `sites` can be satisfied at
    // once: sites_owner_access (via accountId) covers the INSERT itself,
    // and site_id being set from the first query onward is what lets the
    // theme/page inserts that follow, in the same transaction, pass
    // tenant_isolation.
    const siteId = newUlid();

    return withTenantContext(pool, { accountId: principal.accountId, siteId }, async (client) => {
      const site = await createSite(client, { id: siteId, slug: body.slug, name: body.name, ownerId: principal.accountId });
      await createTheme(client, { id: newUlid(), siteId: site.id, tokens: DEFAULT_THEME_TOKENS });

      const page = await createPage(client, { id: newUlid(), siteId: site.id, slug: "home", title: "Home" });
      const heroBlock = {
        id: newUlid(),
        type: HERO_BLOCK_TYPE,
        parent: null,
        order: 1000,
        schemaVersion: 1,
        props: { ...heroDefaultProps },
      };
      const written = await writePageDocument(client, {
        pageId: page.id,
        siteId: site.id,
        title: page.title,
        slug: page.slug,
        blocks: [heroBlock],
        expectedVersion: 0,
      });
      if (!written.ok) throw new Error("unreachable: brand-new page cannot already be at a later version");

      return { site, page: written.document };
    });
  });

  // ---- site.list / site.get ----
  app.get("/v1/sites", async (request) => {
    const principal = await requirePrincipal(request);
    if (principal.kind !== "session") throw forbidden("listing sites requires a signed-in session");
    return withTenantContext(pool, { accountId: principal.accountId }, (client) =>
      listSitesForAccount(client, principal.accountId),
    );
  });

  app.get<{ Params: { siteId: string } }>("/v1/sites/:siteId", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    const site = await withTenantContext(pool, { siteId }, (client) => getSite(client, siteId));
    if (!site) throw notFound("site not found");
    return site;
  });

  // ---- theme.get / theme.update ----
  app.get<{ Params: { siteId: string } }>("/v1/sites/:siteId/theme", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    const theme = await withTenantContext(pool, { siteId }, (client) => getTheme(client, siteId));
    if (!theme) throw notFound("theme not found");
    return theme;
  });

  app.put<{ Params: { siteId: string } }>("/v1/sites/:siteId/theme", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    const body = parseBody(UpdateThemeBodySchema, request.body);
    return withTenantContext(pool, { siteId }, (client) => updateThemeTokens(client, siteId, body.tokens));
  });

  // ---- page.create ----
  app.post<{ Params: { siteId: string } }>("/v1/sites/:siteId/pages", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    const body = parseBody(CreatePageBodySchema, request.body);
    return withTenantContext(pool, { siteId }, (client) =>
      createPage(client, { id: newUlid(), siteId, slug: body.slug, title: body.title }),
    );
  });

  app.get<{ Params: { siteId: string } }>("/v1/sites/:siteId/pages", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    return withTenantContext(pool, { siteId }, (client) => listPagesForSite(client, siteId));
  });

  app.get<{ Params: { siteId: string; pageId: string } }>("/v1/sites/:siteId/pages/:pageId", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    const document = await withTenantContext(pool, { siteId }, (client) => getPageDocument(client, request.params.pageId));
    if (!document || document.siteId !== siteId) throw notFound("page not found");
    return document;
  });

  // ---- page.write — the core mutation (ADR-0003 / ADR-0006 / R17 / R18) ----
  app.put<{ Params: { siteId: string; pageId: string } }>("/v1/sites/:siteId/pages/:pageId", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    const { pageId } = request.params;
    const body = parseBody(WritePageBodySchema, request.body);

    const candidate: PageDocument = {
      id: pageId,
      siteId,
      slug: body.slug,
      title: body.title,
      schemaVersion: 1,
      version: body.expectedVersion,
      blocks: body.blocks,
    };

    // R18: validated as a whole, wholesale-rejected as a whole — never a
    // partial apply. Also migrates each known block's props forward.
    const validated = validatePageDocument(candidate, blockSchemaRegistry);
    if (!validated.ok) {
      throw validationError("document failed validation", validated.issues);
    }

    return withTenantContext(pool, { siteId }, async (client) => {
      const result = await writePageDocument(client, {
        pageId,
        siteId,
        title: validated.document.title,
        slug: validated.document.slug,
        blocks: validated.document.blocks,
        expectedVersion: body.expectedVersion,
      });

      if (!result.ok) {
        // R17: stale-version writes are rejected with the current state and
        // a diff, never silently lost.
        const diff = diffPageDocuments(result.current, candidate);
        throw conflict("page has moved on since expectedVersion", { current: result.current, diff });
      }

      return result.document;
    });
  });

  // ---- token.create ----
  app.post<{ Params: { siteId: string } }>("/v1/sites/:siteId/tokens", async (request) => {
    const principal = await requirePrincipal(request);
    if (principal.kind !== "session") throw forbidden("tokens are minted from a signed-in session, not another token");
    const { siteId, accountId } = await authorizeSite(pool, principal, request.params.siteId);
    const body = parseBody(CreateTokenBodySchema, request.body);

    const raw = generateRawToken();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const token = await withTenantContext(pool, { siteId, accountId }, (client) =>
      createApiToken(client, { id: newUlid(), siteId, accountId, name: body.name, tokenHash: hashToken(raw), expiresAt }),
    );

    return { id: token.id, name: token.name, token: raw, expiresAt: token.expiresAt };
  });

  // ---- site.outline (R14) ----
  app.get<{ Params: { siteId: string } }>("/v1/sites/:siteId/outline", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    return withTenantContext(pool, { siteId }, async (client) => {
      const site = await getSite(client, siteId);
      if (!site) throw notFound("site not found");
      return buildSiteOutline(client, site);
    });
  });

  // ---- publish.create ----
  app.post<{ Params: { siteId: string } }>("/v1/sites/:siteId/publish", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId, accountId } = await authorizeSite(pool, principal, request.params.siteId);

    const { manifest, theme, pages } = await withTenantContext(pool, { siteId }, async (client) => {
      const site = await getSite(client, siteId);
      if (!site) throw notFound("site not found");
      const theme = await getTheme(client, siteId);
      if (!theme) throw notFound("theme not found");
      const pageRefs = await listPagesForSite(client, siteId);
      const pages = (await Promise.all(pageRefs.map((p) => getPageDocument(client, p.id)))).filter(
        (p): p is PageDocument => p !== null,
      );
      return { manifest: await siteManifestFor(client, site), theme, pages };
    });

    // Astro build runs outside the DB transaction — it's slow (real
    // process-level work) and, per R4, must never be able to leave the live
    // pointer half-swapped: the swap below is the only thing that mutates
    // "what's live", and it happens only after a build fully succeeds.
    const built = await buildSiteBundle({ site: manifest, theme, pages, bundleStoreDir });

    const publish = await withTenantContext(pool, { siteId }, async (client) => {
      const record = await createPublish(client, {
        id: newUlid(),
        siteId,
        bundlePath: built.bundlePath,
        contentHash: built.contentHash,
        createdBy: accountId,
      });
      await setLivePublish(client, siteId, record.id);
      return { ...record, isLive: true };
    });

    return { publish, liveUrl: `/v1/sites/${siteId}/live/` };
  });

  // ---- publish.rollback ----
  app.post<{ Params: { siteId: string; publishId: string } }>(
    "/v1/sites/:siteId/publishes/:publishId/rollback",
    async (request) => {
      const principal = await requirePrincipal(request);
      const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
      await withTenantContext(pool, { siteId }, (client) => setLivePublish(client, siteId, request.params.publishId));
      const live = await withTenantContext(pool, { siteId }, (client) => getLivePublish(client, siteId));
      return { publish: live };
    },
  );

  app.get<{ Params: { siteId: string } }>("/v1/sites/:siteId/publishes", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    return withTenantContext(pool, { siteId }, (client) => listPublishes(client, siteId));
  });

  // ---- Serving a bundle: substitutes for real edge hosting (Cloudflare,
  // ADR-0007) in slice 1 — content-addressed, so this route works
  // identically for the live pointer and for any preview build. ----
  app.get<{ Params: { hash: string; "*": string } }>("/v1/bundles/:hash/*", async (request, reply) => {
    const wildcard = request.params["*"] ?? "";
    const relativePath = wildcard === "" || wildcard.endsWith("/") ? `${wildcard}index.html` : wildcard;
    const filePath = path.join(bundleStoreDir, request.params.hash, relativePath);
    if (!filePath.startsWith(path.join(bundleStoreDir, request.params.hash))) {
      throw notFound("not found");
    }
    try {
      await stat(filePath);
    } catch {
      throw notFound("not found");
    }
    reply.type(filePath.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream");
    return reply.send(createReadStream(filePath));
  });

  app.get<{ Params: { siteId: string; "*": string } }>("/v1/sites/:siteId/live/*", async (request, reply) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    const live = await withTenantContext(pool, { siteId }, (client) => getLivePublish(client, siteId));
    if (!live) throw notFound("site has never been published");
    return reply.redirect(`/v1/bundles/${live.contentHash}/${request.params["*"] ?? ""}`, 302);
  });

  // ---- preview (R15): builds the current draft and returns a stable, content-addressed URL ----
  app.post<{ Params: { siteId: string } }>("/v1/sites/:siteId/preview", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);

    const { manifest, theme, pages } = await withTenantContext(pool, { siteId }, async (client) => {
      const site = await getSite(client, siteId);
      if (!site) throw notFound("site not found");
      const theme = await getTheme(client, siteId);
      if (!theme) throw notFound("theme not found");
      const pageRefs = await listPagesForSite(client, siteId);
      const pages = (await Promise.all(pageRefs.map((p) => getPageDocument(client, p.id)))).filter(
        (p): p is PageDocument => p !== null,
      );
      return { manifest: await siteManifestFor(client, site), theme, pages };
    });

    const built = await buildSiteBundle({ site: manifest, theme, pages, bundleStoreDir });
    return { contentHash: built.contentHash, previewUrl: `/v1/bundles/${built.contentHash}/index.html` };
  });

  return app;
}

export { API_MUTATIONS };
