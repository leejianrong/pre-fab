import { createHmac, timingSafeEqual } from "node:crypto";
import { newUlid } from "@prefab/schema";

/**
 * *Our* billing (Slice 8, ADR-0012) — Stripe subscriptions for prefab's own
 * plans. Explicitly, deliberately not the same integration as a tenant's
 * own bring-your-own Stripe for their site's payments (ADR-0005,
 * milestone 2, not built yet): different concern, different credentials
 * (`STRIPE_SECRET_KEY` here vs. a per-tenant OAuth grant there), different
 * webhook endpoint, different lifecycle. Nothing in this file may ever be
 * reused for tenant checkout — a payments block reaching for
 * `StripeProvider` below would be reaching for the wrong Stripe entirely.
 *
 * Same shape as domain-provider.ts (Slice 4), turnstile.ts and email.ts
 * (Slice 3/6): fake-by-default so no automated test or unconfigured
 * environment ever talks to a real provider by accident, a real adapter
 * written from Stripe's public docs and explicitly flagged unverified
 * until it is run against a live account, and an env-gated factory
 * choosing between them. This repo has no Stripe account any more than it
 * has a real Cloudflare zone — the same "sandbox or a recorded fixture"
 * testing approach PLAN.md already commits to for Stripe/calendar providers.
 */

export interface CheckoutSession {
  sessionId: string;
  url: string;
}

export interface StripeProvider {
  createCheckoutSession(input: { accountId: string; priceId: string }): Promise<CheckoutSession>;
  createBillingPortalSession(stripeCustomerId: string): Promise<{ url: string }>;
  cancelSubscription(stripeSubscriptionId: string): Promise<void>;
  /** Verifies and parses an inbound webhook body. Throws if the signature does not match. */
  constructEvent(rawBody: Buffer, signature: string | undefined, webhookSecret: string): StripeEvent;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * In-memory and deterministic, exactly like FakeDomainProvider. There is no
 * real checkout redirect to click through in a test, so completion is
 * driven from outside via apps/api's dev-only
 * `/v1/dev/stripe/:accountId/advance` route — the same "controllable from
 * outside" shape FakeDomainProvider.advance() gives DNS propagation. That
 * route is keyed by accountId directly rather than by this session's id
 * (real Stripe correlates a webhook back to an account via
 * `client_reference_id`/`metadata`, which the dev route has no need to
 * simulate), so this class carries no session state of its own to look up.
 */
export class FakeStripeProvider implements StripeProvider {
  async createCheckoutSession(_input: { accountId: string; priceId: string }): Promise<CheckoutSession> {
    const sessionId = `fake_cs_${newUlid()}`;
    return { sessionId, url: `https://checkout.stripe.example/fake/${sessionId}` };
  }

  async createBillingPortalSession(stripeCustomerId: string): Promise<{ url: string }> {
    return { url: `https://billing.stripe.example/fake/${stripeCustomerId}` };
  }

  async cancelSubscription(_stripeSubscriptionId: string): Promise<void> {
    // No-op: the fake provider has no independent subscription state to
    // cancel — apps/api applies the cancellation to our own `subscriptions`
    // row directly (lib/subscriptions.ts's applyCanceled).
  }

  constructEvent(): StripeEvent {
    throw new Error("FakeStripeProvider never receives a real webhook body — see /v1/dev/stripe/:accountId/advance instead");
  }
}

interface StripeCheckoutSessionResponse {
  id: string;
  url: string;
}

interface StripeSubscriptionResponse {
  id: string;
  customer: string;
}

interface StripePortalSessionResponse {
  url: string;
}

/**
 * UNVERIFIED against a live Stripe account (see module comment above).
 * Written from Stripe's documented Checkout Sessions, Billing Portal
 * Sessions and Subscriptions APIs:
 * https://docs.stripe.com/api/checkout/sessions/create
 * https://docs.stripe.com/api/customer_portal/sessions/create
 * https://docs.stripe.com/api/subscriptions/cancel
 * https://docs.stripe.com/webhooks/signatures
 *
 * Webhook signature verification (`constructEvent`) implements Stripe's
 * documented `Stripe-Signature` scheme (timestamped HMAC-SHA256 over
 * `${timestamp}.${rawBody}`) by hand rather than depending on the `stripe`
 * npm package, to keep this adapter's footprint to exactly the HTTP calls
 * it makes — consistent with every other UNVERIFIED adapter in this file
 * (domain-provider.ts, turnstile.ts) using plain `fetch`, not a vendor SDK.
 */
export class RealStripeProvider implements StripeProvider {
  constructor(
    private readonly secretKey: string,
    private readonly successUrl: string,
    private readonly cancelUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(method: string, path: string, form: Record<string, string>): Promise<T> {
    const response = await this.fetchImpl(`https://api.stripe.com/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Stripe API error (${response.status}): ${body}`);
    }
    return (await response.json()) as T;
  }

  async createCheckoutSession(input: { accountId: string; priceId: string }): Promise<CheckoutSession> {
    const result = await this.request<StripeCheckoutSessionResponse>("POST", "/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": input.priceId,
      "line_items[0][quantity]": "1",
      client_reference_id: input.accountId,
      "metadata[accountId]": input.accountId,
      success_url: this.successUrl,
      cancel_url: this.cancelUrl,
    });
    return { sessionId: result.id, url: result.url };
  }

  async createBillingPortalSession(stripeCustomerId: string): Promise<{ url: string }> {
    const result = await this.request<StripePortalSessionResponse>("POST", "/billing_portal/sessions", {
      customer: stripeCustomerId,
      return_url: this.successUrl,
    });
    return { url: result.url };
  }

  async cancelSubscription(stripeSubscriptionId: string): Promise<void> {
    await this.request<StripeSubscriptionResponse>("DELETE", `/subscriptions/${stripeSubscriptionId}`, {});
  }

  constructEvent(rawBody: Buffer, signature: string | undefined, webhookSecret: string): StripeEvent {
    if (!signature) throw new Error("missing stripe-signature header");
    const parts = Object.fromEntries(signature.split(",").map((part) => part.split("=") as [string, string]));
    const timestamp = parts.t;
    const expectedSignature = parts.v1;
    if (!timestamp || !expectedSignature) throw new Error("malformed stripe-signature header");

    const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
    const computed = createHmac("sha256", webhookSecret).update(signedPayload, "utf8").digest("hex");
    const matches = computed.length === expectedSignature.length && timingSafeEqual(Buffer.from(computed), Buffer.from(expectedSignature));
    if (!matches) throw new Error("stripe webhook signature verification failed");

    return JSON.parse(rawBody.toString("utf8")) as StripeEvent;
  }
}

/** Real Stripe only when a secret key is explicitly configured — see .env.example's STRIPE_SECRET_KEY. */
export function createStripeProvider(env: NodeJS.ProcessEnv = process.env): StripeProvider {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (secretKey) {
    const successUrl = env.STRIPE_CHECKOUT_SUCCESS_URL ?? "http://localhost:5173/billing?checkout=success";
    const cancelUrl = env.STRIPE_CHECKOUT_CANCEL_URL ?? "http://localhost:5173/billing?checkout=cancel";
    return new RealStripeProvider(secretKey, successUrl, cancelUrl);
  }
  return new FakeStripeProvider();
}
