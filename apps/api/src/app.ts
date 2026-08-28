import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { z } from "zod";
import {
  hashToken,
  withTenantContext,
  getAccountByEmail,
  createAccount,
  setVerificationCode,
  markEmailVerified,
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
  createPost,
  getPost,
  writePost,
  listPostsForSite,
  listAllPostsForSite,
  listPostSlugsForSite,
  createPublish,
  setLivePublish,
  getLivePublish,
  listPublishes,
  createAsset,
  getAssetBySha256,
  listAssetsForSite,
  createCustomDomain,
  getCustomDomain,
  listCustomDomainsForSite,
  updateCustomDomainStatus,
  deleteCustomDomain,
  findActiveCustomDomainByHostname,
  getSiteBySlug,
  type Pool,
  type PoolClient,
  type SiteRow,
} from "@prefab/db";
import {
  DEFAULT_THEME_TOKENS,
  dedupeSlug,
  diffPageDocuments,
  diffPostDocuments,
  isPostVisible,
  newUlid,
  rekeyPageForFork,
  slugify,
  validatePageDocument,
  validatePostDocument,
  type PageDocument,
  type PostDocument,
  type SiteManifest,
} from "@prefab/schema";
import { blockSchemaRegistry, HERO_BLOCK_TYPE, heroDefaultProps } from "@prefab/blocks";
import { buildSiteBundle } from "@prefab/publish";
import { TEMPLATE_MANIFESTS, loadTemplateCheckout } from "@prefab/templates/server";
import { ApiError, conflict, forbidden, notFound, unauthorized, validationError } from "./errors.js";
import { API_MUTATIONS } from "./mutations.js";
import { resolvePrincipal, authorizeSite, SESSION_COOKIE, type Principal } from "./lib/auth.js";
import { generateRawToken, generateVerificationCode } from "./lib/tokens.js";
import { buildSiteOutline } from "./lib/outline.js";
import { createOutboxEmailSender } from "./lib/email.js";
import { extensionFor, processImage, readAssetFile, sha256Hex, writeAssetFile } from "./lib/asset-storage.js";
import { classifyDomain, dnsInstructionFor, normalizeHostname, DomainValidationError, type DnsInstruction } from "./lib/domains.js";
import {
  createDomainProvider,
  FakeDomainProvider,
  type DomainProvider,
  type ProviderHostnameStatus,
} from "./lib/domain-provider.js";
import {
  CreatePageBodySchema,
  CreatePostBodySchema,
  CreateSiteBodySchema,
  CreateSiteFromTemplateBodySchema,
  CreateTokenBodySchema,
  DevLoginBodySchema,
  AddDomainBodySchema,
  AdvanceFakeDomainBodySchema,
  ListPostsQuerySchema,
  SignupBodySchema,
  UpdateThemeBodySchema,
  UploadAssetBodySchema,
  VerifyEmailBodySchema,
  WritePageBodySchema,
  WritePostBodySchema,
} from "./schemas.js";

export interface AppDeps {
  pool: Pool;
  bundleStoreDir: string;
  assetStoreDir: string;
  /** The platform's own site-hosting domain (`<slug>.<platformHost>`) — see .env.example's PUBLIC_SITE_HOST. Defaults to "prefab.local" for dev. */
  platformHost?: string;
  /** Injectable so tests (and the dev-only advance endpoint) can reach the exact same provider instance the routes use. Defaults to createDomainProvider()'s env-based choice. */
  domainProvider?: DomainProvider;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw validationError("invalid request body", result.error.issues);
  }
  return result.data;
}

function parseQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw validationError("invalid query parameters", result.error.issues);
  }
  return result.data;
}

/**
 * Shared by the explicit `/v1/bundles/:hash/*` route and the host-based
 * public-routing fallback below — both ultimately serve "this file, out of
 * this content-addressed bundle directory," so the path-traversal guard
 * and content-type logic live in exactly one place.
 */
async function serveBundleFile(
  bundleStoreDir: string,
  contentHash: string,
  wildcardPath: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const relativePath = wildcardPath === "" || wildcardPath.endsWith("/") ? `${wildcardPath}index.html` : wildcardPath;
  const bundleDir = path.join(bundleStoreDir, contentHash);
  const filePath = path.join(bundleDir, relativePath);
  if (!filePath.startsWith(bundleDir)) {
    throw notFound("not found");
  }
  try {
    await stat(filePath);
  } catch {
    throw notFound("not found");
  }
  reply.type(filePath.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream");
  return reply.send(createReadStream(filePath));
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

/** Every custom domain CNAMEs (or ALIAS/ANAMEs, at the apex) to the same platform-wide target — Cloudflare identifies the tenant from the Host header, not from a per-domain target (real Cloudflare-for-SaaS behaviour). */
function cnameTargetFor(platformHost: string): string {
  return `customer-domains.${platformHost}`;
}

function mapProviderStatus(status: ProviderHostnameStatus): "pending_dns" | "active" | "failed" {
  if (status === "active") return "active";
  if (status === "failed") return "failed";
  return "pending_dns";
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { pool, bundleStoreDir, assetStoreDir } = deps;
  const platformHost = deps.platformHost ?? "prefab.local";
  const domainProvider = deps.domainProvider ?? createDomainProvider();
  const platformCnameTarget = cnameTargetFor(platformHost);
  // Every site already has a free address at <slug>.<platformHost> (R1) —
  // this is the base URL RSS/sitemap generation (@prefab/publish) anchors
  // their absolute links to, independent of whether a custom domain is
  // ever added.
  function publicSiteUrl(slug: string): string {
    return `https://${slug}.${platformHost}`;
  }
  // Default is 1 MiB — too small for asset.upload's JSON+base64 body (up
  // to ~10.9 MiB for an 8 MiB file at base64's ~4/3 expansion). Comfortably
  // above that so a legitimately-sized upload never hits Fastify's own
  // body-size rejection before reaching UploadAssetBodySchema's own,
  // precise byte-size validation.
  const app = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024 });
  const { sender: email, outbox: emailOutbox } = createOutboxEmailSender();

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
    // A framework-level rejection (oversized body, malformed JSON) already
    // carries its own 4xx statusCode — surface that as a validation error
    // rather than the internal 500 catch-all below, which is for genuine
    // unexpected failures only.
    if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      reply.status(error.statusCode).send({ error: { code: "validation_error", message: error.message } });
      return;
    }
    app.log.error(error);
    reply.status(500).send({ error: { code: "internal", message: "internal error" } });
  });

  async function requirePrincipal(request: FastifyRequest): Promise<Principal> {
    return resolvePrincipal(pool, request);
  }

  // ---- Dev-only bootstrap (not a product mutation, not in API_MUTATIONS) ----
  // Slice 1's stand-in for real signup — a seeded account gets a browser
  // session with no password. Kept alongside Slice 3's real `/v1/signup` +
  // `/v1/signup/verify` below rather than replaced by them: local dev, CI
  // and this repo's own e2e suite all still seed one account and use this
  // route to get a session for it (SLICES.md: "built on slice 1's identity
  // primitive rather than replacing it").
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

  // ---- Dev-only bootstrap: read back what the outbox sender "sent" (not a
  // product mutation, not in API_MUTATIONS) — the e2e/local-dev stand-in for
  // opening an inbox, the same way `/v1/dev/login` stands in for a password. ----
  app.get<{ Querystring: { to?: string } }>("/v1/dev/emails", async (request) => {
    const { to } = request.query;
    return to ? emailOutbox.filter((message) => message.to === to) : emailOutbox;
  });

  // ---- account.signup (Slice 3) ----
  // Real signup, built on top of the same accounts/sessions tables dev/login
  // uses — passwordless, a 6-digit emailed code instead, which fits
  // ADR-0001's non-technical beachhead better than a password-reset flow.
  app.post("/v1/signup", async (request) => {
    const body = parseBody(SignupBodySchema, request.body);
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const account = await withTenantContext(pool, {}, async (client) => {
      const existing = await getAccountByEmail(client, body.email);
      const account = existing ?? (await createAccount(client, { id: newUlid(), email: body.email }));
      return setVerificationCode(client, account.id, { codeHash: hashToken(code), expiresAt });
    });

    await email.send({
      to: account.email,
      subject: "Your pre-fab verification code",
      text: `Your verification code is ${code}. It expires in 15 minutes.`,
    });

    return { accountId: account.id, status: "pending_verification" as const };
  });

  // ---- account.verifyEmail (Slice 3) ----
  // Verifying mints a session exactly the way dev/login does — the same
  // primitive, reached through a real front door instead of a seeded email.
  app.post("/v1/signup/verify", async (request, reply) => {
    const body = parseBody(VerifyEmailBodySchema, request.body);

    const account = await withTenantContext(pool, {}, (client) => getAccountByEmail(client, body.email));
    const codeMatches = account?.verificationCodeHash === hashToken(body.code);
    const notExpired =
      account?.verificationCodeExpiresAt != null && account.verificationCodeExpiresAt.getTime() > Date.now();
    if (!account || !account.verificationCodeHash || !codeMatches || !notExpired) {
      throw unauthorized("invalid or expired verification code");
    }

    const verified = await withTenantContext(pool, {}, (client) => markEmailVerified(client, account.id));

    const raw = generateRawToken();
    const session = await withTenantContext(pool, {}, (client) =>
      createSession(client, {
        id: newUlid(),
        accountId: verified.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }),
    );
    reply.setCookie(SESSION_COOKIE, raw, { path: "/", httpOnly: true, expires: session.expiresAt });
    return { accountId: verified.id };
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
        responsive: {},
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

  // ---- template.list ----
  // Not a mutation (a plain read), same as site.list/site.get above — no
  // API_MUTATIONS entry, but still worth a read here since agents (R14
  // spirit) and the editor's template gallery both need to enumerate what's
  // available before forking one.
  app.get("/v1/templates", async () => TEMPLATE_MANIFESTS);

  // ---- site.createFromTemplate (Slice 3 / ADR-0011) ----
  // Fork-on-use: every page and block gets a fresh ULID (rekeyPageForFork),
  // so two forks of the same template are independent from the moment
  // they're created — never `push`'s id-preserving write, which is the
  // right choice for round-tripping a site back to itself but the wrong
  // one here. Templates are seeds; they never receive upstream updates
  // (ADR-0011).
  app.post<{ Params: { templateId: string } }>("/v1/templates/:templateId/use", async (request) => {
    const principal = await requirePrincipal(request);
    if (principal.kind !== "session") throw forbidden("sites are created from a signed-in session, not an API token");
    const body = parseBody(CreateSiteFromTemplateBodySchema, request.body);

    const manifest = TEMPLATE_MANIFESTS.find((t) => t.id === request.params.templateId);
    if (!manifest) throw notFound(`unknown template "${request.params.templateId}"`);
    const checkout = await loadTemplateCheckout(manifest.id);

    const siteId = newUlid();

    return withTenantContext(pool, { accountId: principal.accountId, siteId }, async (client) => {
      const site = await createSite(client, { id: siteId, slug: body.slug, name: body.name, ownerId: principal.accountId });
      await createTheme(client, { id: newUlid(), siteId: site.id, tokens: checkout.theme });

      const pages: PageDocument[] = [];
      for (const templatePage of checkout.pages) {
        const created = await createPage(client, { id: newUlid(), siteId: site.id, slug: templatePage.slug, title: templatePage.title });
        const rekeyed = rekeyPageForFork(templatePage, { siteId: site.id, pageId: created.id });
        const written = await writePageDocument(client, {
          pageId: created.id,
          siteId: site.id,
          title: rekeyed.title,
          slug: rekeyed.slug,
          blocks: rekeyed.blocks,
          expectedVersion: 0,
        });
        if (!written.ok) throw new Error("unreachable: brand-new page cannot already be at a later version");
        pages.push(written.document);
      }

      return { site, pages, templateId: manifest.id };
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
      // A pageId that exists but belongs to a different site is invisible
      // under this transaction's RLS context either way — but checked
      // explicitly here (matching the GET route just above) so it surfaces
      // as a 404, not as writePageDocument's internal "page vanished"
      // error falling through to a 500.
      const existing = await getPageDocument(client, pageId);
      if (!existing || existing.siteId !== siteId) throw notFound("page not found");

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

  // ---- post.create (Slice 5) ----
  // An omitted slug is auto-generated from the title and deduped against
  // the site's existing posts — the same discipline @prefab/schema's
  // `dedupeSlug` gets unit-tested against directly.
  app.post<{ Params: { siteId: string } }>("/v1/sites/:siteId/posts", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    const body = parseBody(CreatePostBodySchema, request.body);

    return withTenantContext(pool, { siteId }, async (client) => {
      const existingSlugs = await listPostSlugsForSite(client, siteId);
      const slug = body.slug ? dedupeSlug(body.slug, existingSlugs) : dedupeSlug(slugify(body.title), existingSlugs);
      const date = body.date ?? new Date().toISOString().slice(0, 10);

      return createPost(client, {
        id: newUlid(),
        siteId,
        slug,
        title: body.title,
        date,
        author: body.author,
        tags: body.tags,
        cover: body.cover,
        body: body.body,
        locale: body.locale,
        status: body.status,
      });
    });
  });

  // ---- post.list ----
  app.get<{ Params: { siteId: string } }>("/v1/sites/:siteId/posts", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    const query = parseQuery(ListPostsQuerySchema, request.query);
    return withTenantContext(pool, { siteId }, (client) => listPostsForSite(client, siteId, query));
  });

  // ---- post.get ----
  app.get<{ Params: { siteId: string; postId: string } }>("/v1/sites/:siteId/posts/:postId", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    const post = await withTenantContext(pool, { siteId }, (client) => getPost(client, request.params.postId));
    if (!post || post.siteId !== siteId) throw notFound("post not found");
    return post;
  });

  // ---- post.write — the collection's core mutation, same discipline as page.write (ADR-0006/R17/R18) ----
  app.put<{ Params: { siteId: string; postId: string } }>("/v1/sites/:siteId/posts/:postId", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    const { postId } = request.params;
    const body = parseBody(WritePostBodySchema, request.body);

    const candidate: PostDocument = {
      id: postId,
      siteId,
      slug: body.slug,
      title: body.title,
      schemaVersion: 1,
      version: body.expectedVersion,
      date: body.date,
      author: body.author,
      tags: body.tags,
      cover: body.cover,
      body: body.body,
      locale: body.locale,
      status: body.status,
    };
    const validated = validatePostDocument(candidate);
    if (!validated.ok) throw validationError("post failed validation", validated.issues);

    return withTenantContext(pool, { siteId }, async (client) => {
      const existing = await getPost(client, postId);
      if (!existing || existing.siteId !== siteId) throw notFound("post not found");

      const result = await writePost(client, {
        postId,
        siteId,
        slug: validated.document.slug,
        title: validated.document.title,
        date: validated.document.date,
        author: validated.document.author,
        tags: validated.document.tags,
        cover: validated.document.cover,
        body: validated.document.body,
        locale: validated.document.locale,
        status: validated.document.status,
        expectedVersion: body.expectedVersion,
      });

      if (!result.ok) {
        throw conflict("post has moved on since expectedVersion", {
          current: result.current,
          diff: diffPostDocuments(result.current, candidate),
        });
      }
      return result.document;
    });
  });

  // ---- asset.upload ----
  // JSON + base64 rather than multipart: keeps this mutation identical in
  // shape across all three surfaces (ADR-0003) — the CLI reads a local
  // file and base64-encodes it exactly the way MCP's tool input schema
  // and a fetch() body both already expect, with no separate multipart
  // client needed on any surface.
  app.post<{ Params: { siteId: string } }>("/v1/sites/:siteId/assets", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId, accountId } = await authorizeSite(pool, principal, request.params.siteId);
    const body = parseBody(UploadAssetBodySchema, request.body);

    let bytes: Buffer;
    try {
      bytes = Buffer.from(body.dataBase64, "base64");
    } catch {
      throw validationError("dataBase64 is not valid base64");
    }
    const MAX_BYTES = 8 * 1024 * 1024;
    if (bytes.length === 0 || bytes.length > MAX_BYTES) {
      throw validationError(`asset must be between 1 byte and ${MAX_BYTES} bytes`);
    }

    const sha256 = sha256Hex(bytes);

    // Dedup by hash (integration test: "Asset upload deduplicates
    // identical files by hash") — an identical re-upload returns the
    // existing row untouched rather than writing a second copy or a
    // second DB row.
    const existing = await withTenantContext(pool, { siteId }, (client) => getAssetBySha256(client, siteId, sha256));
    if (existing) return existing;

    const ext = extensionFor(body.contentType, body.filename);
    const key = `${sha256}${ext}`;
    await writeAssetFile(assetStoreDir, key, bytes);

    const { width, height, variants } = await processImage(assetStoreDir, sha256, body.contentType, bytes);

    const asset = await withTenantContext(pool, { siteId }, (client) =>
      createAsset(client, {
        id: newUlid(),
        siteId,
        sha256,
        contentType: body.contentType,
        byteSize: bytes.length,
        filename: body.filename,
        width: width || null,
        height: height || null,
        variants,
        createdBy: accountId,
      }),
    );

    return asset;
  });

  app.get<{ Params: { siteId: string } }>("/v1/sites/:siteId/assets", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    return withTenantContext(pool, { siteId }, (client) => listAssetsForSite(client, siteId));
  });

  // ---- serving a stored asset's bytes: unauthenticated, like bundle
  // serving below — a published page's <img> tag has no API token to
  // send, and the filename is itself the content address (sha256[-wN]),
  // so there is nothing to authorize a GET against. ----
  const ASSET_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
  };

  app.get<{ Params: { filename: string } }>("/v1/assets/:filename", async (request, reply) => {
    const { filename } = request.params;
    if (!/^[a-f0-9]{64}(-w\d+)?\.\w+$/.test(filename)) throw notFound("not found");
    try {
      const bytes = await readAssetFile(assetStoreDir, filename);
      const ext = path.extname(filename);
      reply.type(ASSET_CONTENT_TYPE_BY_EXTENSION[ext] ?? "application/octet-stream");
      return reply.send(bytes);
    } catch {
      throw notFound("not found");
    }
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

  // ---- domain.add / domain.list (Slice 4, ADR-0007) ----
  function dnsInstructionForDomain(hostname: string): DnsInstruction {
    const classification = classifyDomain(hostname, platformHost);
    return dnsInstructionFor(classification, platformCnameTarget);
  }

  app.post<{ Params: { siteId: string } }>("/v1/sites/:siteId/domains", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId, accountId } = await authorizeSite(pool, principal, request.params.siteId);
    const body = parseBody(AddDomainBodySchema, request.body);

    const hostname = normalizeHostname(body.hostname);
    let classification;
    try {
      classification = classifyDomain(hostname, platformHost);
    } catch (error) {
      if (error instanceof DomainValidationError) throw validationError(error.message);
      throw error;
    }

    const created = await domainProvider.createCustomHostname(hostname);

    const domain = await withTenantContext(pool, { siteId, accountId }, (client) =>
      createCustomDomain(client, {
        id: newUlid(),
        siteId,
        hostname,
        isApex: classification.isApex,
        providerHostnameId: created.providerHostnameId,
        cnameTarget: platformCnameTarget,
        createdBy: accountId,
      }),
    );

    return { domain, dnsInstruction: dnsInstructionForDomain(hostname) };
  });

  app.get<{ Params: { siteId: string } }>("/v1/sites/:siteId/domains", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    const domains = await withTenantContext(pool, { siteId }, (client) => listCustomDomainsForSite(client, siteId));
    return domains.map((domain) => ({ domain, dnsInstruction: dnsInstructionForDomain(domain.hostname) }));
  });

  // ---- domain.verify (Slice 4): re-checks the provider now, rather than waiting for the next lazy poll ----
  app.post<{ Params: { siteId: string; domainId: string } }>(
    "/v1/sites/:siteId/domains/:domainId/verify",
    async (request) => {
      const principal = await requirePrincipal(request);
      const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
      const { domainId } = request.params;

      const domain = await withTenantContext(pool, { siteId }, (client) => getCustomDomain(client, siteId, domainId));
      if (!domain) throw notFound("domain not found");
      if (!domain.providerHostnameId) {
        return { domain, dnsInstruction: dnsInstructionForDomain(domain.hostname) };
      }

      const status = await domainProvider.getCustomHostnameStatus(domain.providerHostnameId);
      const updated = await withTenantContext(pool, { siteId }, (client) =>
        updateCustomDomainStatus(client, domainId, {
          status: mapProviderStatus(status.status),
          verificationError: status.verificationErrors.length > 0 ? status.verificationErrors.join("; ") : null,
        }),
      );

      return { domain: updated, dnsInstruction: dnsInstructionForDomain(updated.hostname) };
    },
  );

  // ---- domain.remove (Slice 4): deprovisioning the provider hostname is best-effort — the DB row is what actually controls whether this build's host-routing serves the domain, so it is removed regardless of whether the provider call succeeds. ----
  app.delete<{ Params: { siteId: string; domainId: string } }>("/v1/sites/:siteId/domains/:domainId", async (request) => {
    const principal = await requirePrincipal(request);
    const { siteId } = await authorizeSite(pool, principal, request.params.siteId);
    const { domainId } = request.params;

    const domain = await withTenantContext(pool, { siteId }, (client) => getCustomDomain(client, siteId, domainId));
    if (!domain) throw notFound("domain not found");

    if (domain.providerHostnameId) {
      try {
        await domainProvider.deleteCustomHostname(domain.providerHostnameId);
      } catch (error) {
        app.log.error(error, "failed to deprovision custom hostname with the domain provider — removing our record anyway");
      }
    }

    await withTenantContext(pool, { siteId }, (client) => deleteCustomDomain(client, siteId, domainId));
    return { removed: true };
  });

  // ---- Dev-only: drive the fake domain provider's state, the same "dev-only
  // bootstrap, not a product mutation" pattern as /v1/dev/login and
  // /v1/dev/emails — how e2e and local dev simulate DNS propagation
  // completing (or failing) with no real DNS involved. A no-op 404 when the
  // real Cloudflare provider is configured, since there is nothing fake to advance. ----
  app.post<{ Params: { providerHostnameId: string } }>(
    "/v1/dev/domains/:providerHostnameId/advance",
    async (request) => {
      if (!(domainProvider instanceof FakeDomainProvider)) {
        throw notFound("the fake domain provider is not in use — nothing to advance");
      }
      const body = parseBody(AdvanceFakeDomainBodySchema, request.body);
      domainProvider.advance(request.params.providerHostnameId, body.status, body.verificationErrors ?? []);
      return { ok: true };
    },
  );

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

    const { manifest, theme, pages, posts } = await withTenantContext(pool, { siteId }, async (client) => {
      const site = await getSite(client, siteId);
      if (!site) throw notFound("site not found");
      const theme = await getTheme(client, siteId);
      if (!theme) throw notFound("theme not found");
      const pageRefs = await listPagesForSite(client, siteId);
      const pages = (await Promise.all(pageRefs.map((p) => getPageDocument(client, p.id)))).filter(
        (p): p is PageDocument => p !== null,
      );
      // R "publish includes only published posts": a draft or scheduled
      // (future-dated) post is filtered out *here*, before the build ever
      // sees it — @prefab/publish never re-derives visibility itself, so
      // there is exactly one place this rule can drift.
      const allPosts = await listAllPostsForSite(client, siteId);
      const posts = allPosts.filter((post) => isPostVisible(post));
      return { manifest: await siteManifestFor(client, site), theme, pages, posts };
    });

    // Astro build runs outside the DB transaction — it's slow (real
    // process-level work) and, per R4, must never be able to leave the live
    // pointer half-swapped: the swap below is the only thing that mutates
    // "what's live", and it happens only after a build fully succeeds.
    const built = await buildSiteBundle({ site: manifest, theme, pages, posts, baseUrl: publicSiteUrl(manifest.slug), bundleStoreDir });

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
    return serveBundleFile(bundleStoreDir, request.params.hash, request.params["*"] ?? "", reply);
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

    const { manifest, theme, pages, posts } = await withTenantContext(pool, { siteId }, async (client) => {
      const site = await getSite(client, siteId);
      if (!site) throw notFound("site not found");
      const theme = await getTheme(client, siteId);
      if (!theme) throw notFound("theme not found");
      const pageRefs = await listPagesForSite(client, siteId);
      const pages = (await Promise.all(pageRefs.map((p) => getPageDocument(client, p.id)))).filter(
        (p): p is PageDocument => p !== null,
      );
      // Preview shows every post, drafts and scheduled ones included — it's
      // "what the author is working on," not "what's public" (that
      // filtering only happens at publish time, above).
      const posts = await listAllPostsForSite(client, siteId);
      return { manifest: await siteManifestFor(client, site), theme, pages, posts };
    });

    const built = await buildSiteBundle({ site: manifest, theme, pages, posts, baseUrl: publicSiteUrl(manifest.slug), bundleStoreDir });
    return { contentHash: built.contentHash, previewUrl: `/v1/bundles/${built.contentHash}/index.html` };
  });

  // ---- Host-based public routing (Slice 4 / R1): every request that
  // matches no route above falls through here. This is what actually
  // makes "<slug>.<platformHost>" — the free hosting every site already
  // gets — and an `active` custom domain resolve to anything; before this,
  // the only public address for a site was its opaque content-hash bundle
  // URL. Unauthenticated on purpose, same reasoning as /v1/bundles/:hash/*:
  // a published site's address is meant to be public. ----
  app.setNotFoundHandler(async (request, reply) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply.status(404).send({ error: { code: "not_found", message: "not found" } });
    }

    const host = (request.headers.host ?? "").split(":")[0] ?? "";
    let siteId: string | null = null;

    if (host !== "" && host.endsWith(`.${platformHost}`)) {
      const slug = host.slice(0, -(platformHost.length + 1));
      const site = await withTenantContext(pool, {}, (client) => getSiteBySlug(client, slug));
      siteId = site?.id ?? null;
    } else if (host !== "") {
      const domain = await withTenantContext(pool, {}, (client) => findActiveCustomDomainByHostname(client, host));
      siteId = domain?.siteId ?? null;
    }

    if (!siteId) {
      return reply.status(404).send({ error: { code: "not_found", message: "not found" } });
    }

    const live = await withTenantContext(pool, { siteId }, (client) => getLivePublish(client, siteId as string));
    if (!live) {
      reply.type("text/html; charset=utf-8");
      return reply.status(404).send("<!doctype html><title>Not published</title><p>This site hasn't been published yet.</p>");
    }

    const wildcardPath = request.url.split("?")[0]?.replace(/^\//, "") ?? "";
    return serveBundleFile(bundleStoreDir, live.contentHash, wildcardPath, reply);
  });

  return app;
}

export { API_MUTATIONS };
