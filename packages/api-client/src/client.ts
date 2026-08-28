import type {
  Asset,
  ConflictDetails,
  CreateSiteFromTemplateResult,
  CreateSiteResult,
  DomainWithInstruction,
  IssuedApiToken,
  PageDocument,
  PageSummary,
  PreviewResult,
  PublishRecord,
  PublishResult,
  SignupResult,
  SiteOutline,
  SiteSummary,
  TemplateSummary,
  ThemeDocument,
  ThemeTokens,
  UploadAssetInput,
  VerifyEmailResult,
  WritePageInput,
} from "./types.js";

export type ApiErrorCode = "validation_error" | "not_found" | "conflict" | "unauthorized" | "forbidden" | "internal";

/**
 * Every ApiError the server throws (apps/api/src/errors.ts) lands here with
 * its `code` intact — this is what apps/cli maps onto R13's exit codes
 * (1 user error, 2 conflict, 3 auth, 4 upstream) without string-matching.
 */
export class ApiClientError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  /** Narrows `details` when this is the one error shape that carries a typed payload. */
  asConflict(): ConflictDetails | undefined {
    return this.code === "conflict" ? (this.details as ConflictDetails) : undefined;
  }
}

/** Thrown for network failure — no response at all, as opposed to an error response (R13's exit code 4, "upstream"). */
export class ApiUnreachableError extends Error {
  constructor(cause: unknown) {
    super(`could not reach the prefab API: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ApiUnreachableError";
    this.cause = cause;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** A per-site API token (ADR-0001) — set for the CLI and MCP. Omit for the browser editor, which authenticates via cookie. */
  token?: string;
  /**
   * A previously-captured session cookie (see `devLogin`). Node's fetch has
   * no persistent cookie jar the way a browser does, so the CLI must carry
   * this explicitly across process runs (e.g. a local config file) — the
   * browser editor never sets this, relying on `credentials: "include"`
   * instead.
   */
  cookie?: string;
  /** Per-request abort timeout in ms. Default 10s. */
  timeoutMs?: number;
}

export class ApiClient {
  private sessionCookie: string | undefined;

  constructor(private readonly options: ApiClientOptions) {
    this.sessionCookie = options.cookie;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(this.options.token
            ? { authorization: `Bearer ${this.options.token}` }
            : this.sessionCookie
              ? { cookie: this.sessionCookie }
              : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: this.options.token || this.sessionCookie ? "omit" : "include",
        // A refused connection fails fast on its own; this bound is for a
        // network that silently drops packets instead — R16 requires a
        // blocked network to fail with exit code 4, never hang.
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch (error) {
      throw new ApiUnreachableError(error);
    }

    if (response.status === 204) return undefined as T;

    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = payload?.error ?? { code: "internal", message: `request failed with status ${response.status}` };
      throw new ApiClientError(error.code, response.status, error.message, error.details);
    }
    return payload as T;
  }

  // ---- identity bootstrap ----
  /**
   * Shared by every endpoint that can mint a session cookie (dev/login,
   * signup verification) — bypasses `request()` because it needs the
   * response *headers*, not just the body. `getSessionCookie()` lets a
   * caller (the CLI) persist it across process runs.
   */
  private async authRequest<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch (error) {
      throw new ApiUnreachableError(error);
    }

    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = payload?.error ?? { code: "internal", message: `request failed with status ${response.status}` };
      throw new ApiClientError(error.code, response.status, error.message, error.details);
    }

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.sessionCookie = setCookie.split(";")[0];

    return payload as T;
  }

  /** Dev-only bootstrap (see apps/api's `/v1/dev/login`) — real signup below replaces this for production users. */
  devLogin(email: string): Promise<{ accountId: string }> {
    return this.authRequest("/v1/dev/login", { email });
  }

  getSessionCookie(): string | undefined {
    return this.sessionCookie;
  }

  // ---- account.signup / account.verifyEmail (Slice 3) ----
  signup(email: string): Promise<SignupResult> {
    return this.request("POST", "/v1/signup", { email });
  }

  /** Verifying mints a session exactly like `devLogin` — see `authRequest`. */
  verifyEmail(email: string, code: string): Promise<VerifyEmailResult> {
    return this.authRequest("/v1/signup/verify", { email, code });
  }

  // ---- template.list / site.createFromTemplate (Slice 3, ADR-0011) ----
  listTemplates(): Promise<TemplateSummary[]> {
    return this.request("GET", "/v1/templates");
  }

  createSiteFromTemplate(templateId: string, input: { slug: string; name: string }): Promise<CreateSiteFromTemplateResult> {
    return this.request("POST", `/v1/templates/${templateId}/use`, input);
  }

  // ---- domain.add / domain.list / domain.verify / domain.remove (Slice 4) ----
  addDomain(siteId: string, hostname: string): Promise<DomainWithInstruction> {
    return this.request("POST", `/v1/sites/${siteId}/domains`, { hostname });
  }

  listDomains(siteId: string): Promise<DomainWithInstruction[]> {
    return this.request("GET", `/v1/sites/${siteId}/domains`);
  }

  verifyDomain(siteId: string, domainId: string): Promise<DomainWithInstruction> {
    return this.request("POST", `/v1/sites/${siteId}/domains/${domainId}/verify`);
  }

  removeDomain(siteId: string, domainId: string): Promise<{ removed: true }> {
    return this.request("DELETE", `/v1/sites/${siteId}/domains/${domainId}`);
  }

  // ---- site.create / site.list / site.get ----
  createSite(input: { slug: string; name: string }): Promise<CreateSiteResult> {
    return this.request("POST", "/v1/sites", input);
  }

  listSites(): Promise<SiteSummary[]> {
    return this.request("GET", "/v1/sites");
  }

  getSite(siteId: string): Promise<SiteSummary> {
    return this.request("GET", `/v1/sites/${siteId}`);
  }

  // ---- theme.get / theme.update ----
  getTheme(siteId: string): Promise<ThemeDocument> {
    return this.request("GET", `/v1/sites/${siteId}/theme`);
  }

  updateTheme(siteId: string, tokens: ThemeTokens): Promise<ThemeDocument> {
    return this.request("PUT", `/v1/sites/${siteId}/theme`, { tokens });
  }

  // ---- page.create / page.write ----
  createPage(siteId: string, input: { slug: string; title: string }): Promise<PageDocument> {
    return this.request("POST", `/v1/sites/${siteId}/pages`, input);
  }

  listPages(siteId: string): Promise<PageSummary[]> {
    return this.request("GET", `/v1/sites/${siteId}/pages`);
  }

  getPage(siteId: string, pageId: string): Promise<PageDocument> {
    return this.request("GET", `/v1/sites/${siteId}/pages/${pageId}`);
  }

  writePage(siteId: string, pageId: string, input: WritePageInput): Promise<PageDocument> {
    return this.request("PUT", `/v1/sites/${siteId}/pages/${pageId}`, input);
  }

  // ---- asset.upload / asset.list ----
  uploadAsset(siteId: string, input: UploadAssetInput): Promise<Asset> {
    return this.request("POST", `/v1/sites/${siteId}/assets`, input);
  }

  listAssets(siteId: string): Promise<Asset[]> {
    return this.request("GET", `/v1/sites/${siteId}/assets`);
  }

  // ---- token.create ----
  createToken(siteId: string, input: { name: string }): Promise<IssuedApiToken> {
    return this.request("POST", `/v1/sites/${siteId}/tokens`, input);
  }

  // ---- site.outline (R14) ----
  getOutline(siteId: string): Promise<SiteOutline> {
    return this.request("GET", `/v1/sites/${siteId}/outline`);
  }

  // ---- publish.create / publish.rollback ----
  publish(siteId: string): Promise<PublishResult> {
    return this.request("POST", `/v1/sites/${siteId}/publish`);
  }

  rollback(siteId: string, publishId: string): Promise<{ publish: PublishRecord }> {
    return this.request("POST", `/v1/sites/${siteId}/publishes/${publishId}/rollback`);
  }

  listPublishes(siteId: string): Promise<PublishRecord[]> {
    return this.request("GET", `/v1/sites/${siteId}/publishes`);
  }

  // ---- preview (R15) ----
  preview(siteId: string): Promise<PreviewResult> {
    return this.request("POST", `/v1/sites/${siteId}/preview`);
  }

  resolveUrl(path: string): string {
    return `${this.options.baseUrl}${path}`;
  }
}
