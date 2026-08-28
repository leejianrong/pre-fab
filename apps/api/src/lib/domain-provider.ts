import { newUlid } from "@prefab/schema";

/**
 * The seam Cloudflare SSL for SaaS sits behind (SLICES.md Slice 4:
 * "Cloudflare SSL for SaaS integration... [ASSUMED — Cloudflare as the
 * hosting platform, ADR-0007]"). Mirrors the shape Slice 3 established for
 * email (apps/api/src/lib/email.ts) and the shape PLAN.md's testing
 * approach already commits to for Stripe/calendar providers: "against
 * their sandbox or a recorded fixture." No Cloudflare account or domain
 * exists yet in this environment, so every test in this repo runs against
 * `FakeDomainProvider` — `CloudflareDomainProvider` below is written
 * against Cloudflare's public Custom Hostnames API docs but has never been
 * exercised against a live account. Treat it as a well-informed draft, not
 * a verified integration, until someone runs it against a real zone.
 */

export type ProviderHostnameStatus = "pending" | "active" | "failed";

export interface CustomHostnameResult {
  providerHostnameId: string;
  status: ProviderHostnameStatus;
  verificationErrors: string[];
}

export interface DomainProvider {
  createCustomHostname(hostname: string): Promise<CustomHostnameResult>;
  getCustomHostnameStatus(providerHostnameId: string): Promise<CustomHostnameResult>;
  deleteCustomHostname(providerHostnameId: string): Promise<void>;
}

interface FakeHostnameState {
  status: ProviderHostnameStatus;
  verificationErrors: string[];
}

/**
 * In-memory, deterministic, and — critically — controllable from outside:
 * `advance()` is what lets a test (or the dev-only HTTP endpoint in
 * app.ts) simulate DNS propagation completing or failing, since nothing
 * here ever talks to real DNS. New hostnames start `pending`, exactly like
 * a real Cloudflare custom hostname does before validation completes.
 */
export class FakeDomainProvider implements DomainProvider {
  private readonly hostnames = new Map<string, FakeHostnameState>();

  async createCustomHostname(_hostname: string): Promise<CustomHostnameResult> {
    const providerHostnameId = `fake_${newUlid()}`;
    this.hostnames.set(providerHostnameId, { status: "pending", verificationErrors: [] });
    return { providerHostnameId, status: "pending", verificationErrors: [] };
  }

  async getCustomHostnameStatus(providerHostnameId: string): Promise<CustomHostnameResult> {
    const state = this.hostnames.get(providerHostnameId);
    if (!state) throw new Error(`FakeDomainProvider: unknown hostname id "${providerHostnameId}"`);
    return { providerHostnameId, ...state };
  }

  async deleteCustomHostname(providerHostnameId: string): Promise<void> {
    this.hostnames.delete(providerHostnameId);
  }

  /** Dev/test-only: force a hostname's status. Never called from any production code path. */
  advance(providerHostnameId: string, status: ProviderHostnameStatus, verificationErrors: string[] = []): void {
    if (!this.hostnames.has(providerHostnameId)) {
      throw new Error(`FakeDomainProvider: unknown hostname id "${providerHostnameId}"`);
    }
    this.hostnames.set(providerHostnameId, { status, verificationErrors });
  }
}

interface CloudflareCustomHostname {
  id: string;
  status: string;
  ssl?: { status?: string; validation_errors?: Array<{ message: string }> };
}

interface CloudflareEnvelope<T> {
  success: boolean;
  errors: Array<{ message: string }>;
  result: T | null;
}

/**
 * UNVERIFIED against a live Cloudflare account (see module comment above).
 * Written from Cloudflare's documented Custom Hostnames for SaaS API:
 * https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-management/
 *
 * Cloudflare's own hostname `status` values are more granular than ours
 * ("pending", "active", "active_redeploying", "moved", "pending_deletion",
 * "deleted", "pending_blocked", "pending_migration", "pending_provisioned",
 * "test_pending", "test_active", "test_active_apex", "test_blocked",
 * "test_failed", "provisioned", "blocked") — `mapStatus` below collapses
 * them to our three (pending/active/failed), which is all a customer
 * dashboard needs to show.
 */
export class CloudflareDomainProvider implements DomainProvider {
  constructor(
    private readonly apiToken: string,
    private readonly zoneId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`https://api.cloudflare.com/client/v4/zones/${this.zoneId}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiToken}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const envelope = (await response.json()) as CloudflareEnvelope<T>;
    if (!response.ok || !envelope.success) {
      const message = envelope.errors?.map((e) => e.message).join("; ") || `Cloudflare API request failed (${response.status})`;
      throw new Error(message);
    }
    return envelope.result as T;
  }

  private mapStatus(hostname: CloudflareCustomHostname): ProviderHostnameStatus {
    if (["active", "active_redeploying", "provisioned", "test_active", "test_active_apex"].includes(hostname.status)) {
      return "active";
    }
    if (["blocked", "test_blocked", "test_failed", "deleted"].includes(hostname.status)) {
      return "failed";
    }
    return "pending";
  }

  private toResult(hostname: CloudflareCustomHostname): CustomHostnameResult {
    return {
      providerHostnameId: hostname.id,
      status: this.mapStatus(hostname),
      verificationErrors: (hostname.ssl?.validation_errors ?? []).map((e) => e.message),
    };
  }

  async createCustomHostname(hostname: string): Promise<CustomHostnameResult> {
    const created = await this.request<CloudflareCustomHostname>("POST", "/custom_hostnames", {
      hostname,
      ssl: { method: "cname", type: "dv" },
    });
    return this.toResult(created);
  }

  async getCustomHostnameStatus(providerHostnameId: string): Promise<CustomHostnameResult> {
    const hostname = await this.request<CloudflareCustomHostname>("GET", `/custom_hostnames/${providerHostnameId}`);
    return this.toResult(hostname);
  }

  async deleteCustomHostname(providerHostnameId: string): Promise<void> {
    await this.request<null>("DELETE", `/custom_hostnames/${providerHostnameId}`);
  }
}

/**
 * Real Cloudflare only when both credentials are explicitly configured —
 * every automated test in this repo (and any environment that hasn't set
 * these) gets the fake, never by accident.
 */
export function createDomainProvider(env: NodeJS.ProcessEnv = process.env): DomainProvider {
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  const zoneId = env.CLOUDFLARE_ZONE_ID;
  if (apiToken && zoneId) return new CloudflareDomainProvider(apiToken, zoneId);
  return new FakeDomainProvider();
}
