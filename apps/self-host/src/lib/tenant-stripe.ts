import { createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";

/**
 * A trimmed, self-contained duplicate of
 * apps/api/src/lib/tenant-stripe-provider.ts (ADR-0005, KAN-1137) —
 * apps/self-host cannot import apps/api (no cross-app dependency; the
 * self-host runtime must stay extractable and independently installable,
 * ADR-0010), so this is the same "duplicated, not imported" discipline
 * booking-manifest.ts/form-manifest.ts already use for the identical
 * reason. Unlike two-way calendar sync (deliberately unavailable in
 * self-host — see runtime-adapters.ts's own comment), one-off payments
 * need no ongoing platform dependency beyond the OAuth connect step itself
 * (ADR-0005: it's the tenant's own Stripe account) — R10 holds for
 * payments the same way it holds for local availability/bookings.
 *
 * Fake by default, same discipline as every other adapter in this repo.
 * The real half is UNVERIFIED against a live Stripe account, written from
 * the same public docs apps/api's own copy is.
 */
export interface TenantStripeTokens {
  accessToken: string;
  stripeAccountId: string;
}

export interface CreateCheckoutSessionInput {
  accessToken: string;
  stripeAccountId: string;
  amount: number;
  currency: string;
  productName: string;
  successUrl: string;
  cancelUrl: string;
  paymentRecordId: string;
  siteId: string;
}

export interface CheckoutSession {
  sessionId: string;
  url: string;
}

/** KAN-1154 / ADR-0016: mirrors apps/api/src/lib/tenant-stripe-provider.ts's own `CreateSubscriptionCheckoutSessionInput` — see that file for the fully-documented original this trims. */
export interface CreateSubscriptionCheckoutSessionInput {
  accessToken: string;
  stripeAccountId: string;
  price: number;
  currency: string;
  interval: "month" | "year";
  trialPeriodDays: number;
  productName: string;
  successUrl: string;
  cancelUrl: string;
  subscriptionRecordId: string;
  siteId: string;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  account?: string;
}

export interface TenantStripeProvider {
  connect(input: { authorizationCode: string }): Promise<TenantStripeTokens>;
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession>;
  /** KAN-1154 / ADR-0016 — a sibling method, not a `mode` param on createCheckoutSession above (see apps/api's own copy for the full reasoning). */
  createSubscriptionCheckoutSession(input: CreateSubscriptionCheckoutSessionInput): Promise<CheckoutSession>;
  constructEvent(rawBody: Buffer, signature: string | undefined, webhookSecret: string): StripeEvent;
}

export class FakeTenantStripeProvider implements TenantStripeProvider {
  async connect(): Promise<TenantStripeTokens> {
    return { accessToken: `fake-access-${randomUUID()}`, stripeAccountId: `fake-acct-${randomUUID()}` };
  }

  async createCheckoutSession(): Promise<CheckoutSession> {
    const sessionId = `fake_cs_${randomUUID()}`;
    return { sessionId, url: `https://checkout.stripe.example/fake/${sessionId}` };
  }

  async createSubscriptionCheckoutSession(): Promise<CheckoutSession> {
    const sessionId = `fake_cs_sub_${randomUUID()}`;
    return { sessionId, url: `https://checkout.stripe.example/fake/${sessionId}` };
  }

  constructEvent(): StripeEvent {
    throw new Error("FakeTenantStripeProvider never receives a real webhook body — see /v1/dev/stripe-connect/advance instead");
  }
}

interface StripeOAuthTokenResponse {
  access_token: string;
  stripe_user_id: string;
}

interface StripeCheckoutSessionResponse {
  id: string;
  url: string;
}

/** UNVERIFIED against a live Stripe account — see apps/api/src/lib/tenant-stripe-provider.ts for the fully-documented original this mirrors. */
export class RealTenantStripeProvider implements TenantStripeProvider {
  constructor(
    private readonly platformSecretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async connect(input: { authorizationCode: string }): Promise<TenantStripeTokens> {
    const response = await this.fetchImpl("https://connect.stripe.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: input.authorizationCode, client_secret: this.platformSecretKey }),
    });
    if (!response.ok) throw new Error(`Stripe Connect OAuth token exchange failed (${response.status})`);
    const token = (await response.json()) as StripeOAuthTokenResponse;
    return { accessToken: token.access_token, stripeAccountId: token.stripe_user_id };
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    const response = await this.fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.platformSecretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "stripe-account": input.stripeAccountId,
      },
      body: new URLSearchParams({
        mode: "payment",
        "line_items[0][price_data][currency]": input.currency,
        "line_items[0][price_data][product_data][name]": input.productName,
        "line_items[0][price_data][unit_amount]": String(input.amount),
        "line_items[0][quantity]": "1",
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.paymentRecordId,
        "metadata[siteId]": input.siteId,
        "metadata[paymentRecordId]": input.paymentRecordId,
      }),
    });
    if (!response.ok) throw new Error(`Stripe API error (${response.status})`);
    const result = (await response.json()) as StripeCheckoutSessionResponse;
    return { sessionId: result.id, url: result.url };
  }

  /** KAN-1154 / ADR-0016 — mirrors apps/api's own copy exactly (mode: "subscription", price_data[recurring][interval], an optional subscription_data[trial_period_days]). KAN-1154 part 2 addendum: `subscription_data[metadata]` is also always sent, mirroring apps/api's own copy's fully-documented reasoning — it's what lets this instance's own webhook route (see app.ts) resolve siteId from every subscription-lifecycle event after checkout.session.completed, since a self-hosted instance's own `subscription_records` row has no accounts/tenant table to look anything up in either. UNVERIFIED against a live Stripe account. */
  async createSubscriptionCheckoutSession(input: CreateSubscriptionCheckoutSessionInput): Promise<CheckoutSession> {
    const body = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price_data][currency]": input.currency,
      "line_items[0][price_data][product_data][name]": input.productName,
      "line_items[0][price_data][unit_amount]": String(input.price),
      "line_items[0][price_data][recurring][interval]": input.interval,
      "line_items[0][quantity]": "1",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.subscriptionRecordId,
      "metadata[siteId]": input.siteId,
      "metadata[subscriptionRecordId]": input.subscriptionRecordId,
      "subscription_data[metadata][siteId]": input.siteId,
      "subscription_data[metadata][subscriptionRecordId]": input.subscriptionRecordId,
    });
    if (input.trialPeriodDays > 0) {
      body.set("subscription_data[trial_period_days]", String(input.trialPeriodDays));
    }

    const response = await this.fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.platformSecretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "stripe-account": input.stripeAccountId,
      },
      body,
    });
    if (!response.ok) throw new Error(`Stripe API error (${response.status})`);
    const result = (await response.json()) as StripeCheckoutSessionResponse;
    return { sessionId: result.id, url: result.url };
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

/** Real only when both STRIPE_CONNECT_CLIENT_ID and STRIPE_SECRET_KEY are set — unset (the default) always returns the fake. */
export function createTenantStripeProvider(env: NodeJS.ProcessEnv = process.env): TenantStripeProvider {
  if (env.STRIPE_CONNECT_CLIENT_ID && env.STRIPE_SECRET_KEY) {
    return new RealTenantStripeProvider(env.STRIPE_SECRET_KEY);
  }
  return new FakeTenantStripeProvider();
}
