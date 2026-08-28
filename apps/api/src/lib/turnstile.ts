import type { TurnstileVerifier } from "@prefab/runtime";

/**
 * Same shape as domain-provider.ts (Slice 4) and email.ts (Slice 3):
 * fake-by-default so no automated test or unconfigured environment ever
 * talks to a real provider by accident, a real adapter written from
 * Cloudflare's public docs and explicitly flagged unverified until it's
 * run against a live account, and an env-gated factory choosing between
 * them. This repo has no Turnstile secret key any more than it has a real
 * Cloudflare zone.
 */

/** Always succeeds — the default for every test and any environment with no secret key configured. Forms default to `turnstileEnabled: false` (@prefab/blocks' Form schema) precisely so this is never exercised unless an owner opts in. */
export class FakeTurnstileVerifier implements TurnstileVerifier {
  async verify(_token: string, _ip: string | null): Promise<{ success: boolean }> {
    return { success: true };
  }
}

/** Deterministic for tests that need a failure path, without reaching for the network. */
export class AlwaysFailTurnstileVerifier implements TurnstileVerifier {
  async verify(_token: string, _ip: string | null): Promise<{ success: boolean }> {
    return { success: false };
  }
}

interface CloudflareSiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

/**
 * UNVERIFIED against a live Cloudflare account (see module comment above).
 * Written from Cloudflare's documented Turnstile server-side verification
 * API: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
export class CloudflareTurnstileVerifier implements TurnstileVerifier {
  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async verify(token: string, ip: string | null): Promise<{ success: boolean }> {
    const body = new URLSearchParams({ secret: this.secretKey, response: token });
    if (ip) body.set("remoteip", ip);

    const response = await this.fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) return { success: false };
    const result = (await response.json()) as CloudflareSiteverifyResponse;
    return { success: result.success === true };
  }
}

/** Real Cloudflare only when a secret key is explicitly configured — see .env.example's TURNSTILE_SECRET_KEY. */
export function createTurnstileVerifier(env: NodeJS.ProcessEnv = process.env): TurnstileVerifier {
  const secretKey = env.TURNSTILE_SECRET_KEY;
  if (secretKey) return new CloudflareTurnstileVerifier(secretKey);
  return new FakeTurnstileVerifier();
}
