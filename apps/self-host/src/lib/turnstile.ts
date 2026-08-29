import type { TurnstileVerifier } from "@prefab/runtime";

/**
 * Same shape as apps/api/src/lib/turnstile.ts (deliberately duplicated,
 * not imported — apps/api is the control plane, and this package must
 * never depend on it): fake-by-default so no self-hosted instance talks to
 * a real provider unless its operator explicitly configures one, and a real
 * adapter written from Cloudflare's documented API, flagged UNVERIFIED
 * until it's run against a live account.
 */
export class FakeTurnstileVerifier implements TurnstileVerifier {
  async verify(_token: string, _ip: string | null): Promise<{ success: boolean }> {
    return { success: true };
  }
}

interface CloudflareSiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

/** UNVERIFIED against a live Cloudflare account — see apps/api/src/lib/turnstile.ts's own equivalent for the same caveat. */
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

/** Real Cloudflare only when TURNSTILE_SECRET_KEY is explicitly set — see this package's README. */
export function createTurnstileVerifier(env: NodeJS.ProcessEnv = process.env): TurnstileVerifier {
  const secretKey = env.TURNSTILE_SECRET_KEY;
  if (secretKey) return new CloudflareTurnstileVerifier(secretKey);
  return new FakeTurnstileVerifier();
}
