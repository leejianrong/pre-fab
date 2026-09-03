import { createHmac, timingSafeEqual } from "node:crypto";
import { newUlid } from "@prefab/schema";

/**
 * KAN-1137 / ADR-0005: a site owner's OWN Stripe account, connected via
 * OAuth (Connect "Standard" accounts) — the bring-your-own model, not the
 * Connect-as-platform model ADR-0005 rejected. Deliberately not the same
 * integration as lib/stripe.ts's *our* billing (see that file's own module
 * comment): different concern, different credentials (this adapter's
 * `stripeAccountId`/per-tenant OAuth access token vs. that one's
 * `STRIPE_SECRET_KEY`), different webhook endpoint/secret
 * (`STRIPE_CONNECT_WEBHOOK_SECRET`, not `STRIPE_WEBHOOK_SECRET`), different
 * lifecycle. Nothing in lib/stripe.ts is reused here, and nothing here is
 * ever reused for platform billing.
 *
 * Same shape as every sibling adapter in this file's neighbours
 * (calendar-provider.ts, stripe.ts, domain-provider.ts, turnstile.ts): an
 * interface, an in-memory fake every automated test runs against by
 * default, a real adapter written from Stripe's public docs and explicitly
 * flagged UNVERIFIED until it is run against a live account, and an
 * env-gated factory choosing between them. No real Stripe account exists
 * in this environment, same constraint as every other third-party
 * integration here.
 *
 * `connect` takes a pre-obtained OAuth authorization code (the owner
 * completes Stripe's own Connect consent screen in the browser; the editor
 * hands the resulting code to `stripe.connect`) rather than driving the
 * authorize redirect itself — the identical shape
 * RealGoogleCalendarProvider/RealMicrosoftCalendarProvider already use for
 * exactly the same reason (calendar-provider.ts's own module comment).
 */

export interface TenantStripeTokens {
  accessToken: string;
  stripeAccountId: string;
}

export interface CreateCheckoutSessionInput {
  /** The connected account's own OAuth access token — stored on `stripe_connections`, never sent to Stripe: direct-charge Checkout authenticates as the PLATFORM account (`stripeAccountId` below, via the `Stripe-Account` header), not as the tenant. Kept on the input for interface symmetry with `connect`'s own output and so a future adapter that *does* need it (e.g. reading the connected account's own balance) has it in hand. */
  accessToken: string;
  /** Which connected account this direct charge is for — sent as Stripe's `Stripe-Account` header (https://docs.stripe.com/connect/direct-charges). */
  stripeAccountId: string;
  /** Cents. */
  amount: number;
  /** Lowercase ISO 4217, e.g. "usd". */
  currency: string;
  productName: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Beyond what ADR-0005/KAN-1137's brief spelled out for this interface:
   * a real Stripe Connect webhook (`/v1/webhooks/stripe-connect`) arrives
   * with no tenant context and no siteId in its URL at all (unlike the
   * dev-advance route, which gets one from its own path) — `payment_records`
   * carries RLS keyed on site_id (R20), so the webhook handler must resolve
   * siteId *before* it can touch that table at all. Threading these two
   * identifiers into Checkout's own `client_reference_id`/`metadata` (the
   * exact mechanism lib/stripe.ts's RealStripeProvider already uses to
   * carry `accountId` through `checkout.session.completed`) is what makes
   * that resolution possible with no query needed first.
   */
  paymentRecordId: string;
  siteId: string;
}

export interface CheckoutSession {
  sessionId: string;
  url: string;
}

/** Real Connect webhook events additionally carry `account`, naming which connected account the event is for (https://docs.stripe.com/connect/webhooks) — absent from lib/stripe.ts's own StripeEvent because platform billing's webhook has no connected accounts at all. */
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  account?: string;
}

export interface TenantStripeProvider {
  connect(input: { authorizationCode: string }): Promise<TenantStripeTokens>;
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession>;
  /** Verifies and parses an inbound Connect webhook body. Throws if the signature does not match. */
  constructEvent(rawBody: Buffer, signature: string | undefined, webhookSecret: string): StripeEvent;
}

/**
 * In-memory and deterministic, exactly like FakeStripeProvider/
 * FakeCalendarProvider. There is no real Connect OAuth consent screen or
 * Checkout page to click through in a test, so completion is driven from
 * outside via apps/api's dev-only `/v1/dev/stripe-connect/:siteId/advance`
 * route — the same "controllable from outside" shape FakeStripeProvider's
 * own `/v1/dev/stripe/:accountId/advance` gives platform billing.
 */
export class FakeTenantStripeProvider implements TenantStripeProvider {
  async connect(): Promise<TenantStripeTokens> {
    return { accessToken: `fake-access-${newUlid()}`, stripeAccountId: `fake-acct-${newUlid()}` };
  }

  async createCheckoutSession(_input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    const sessionId = `fake_cs_${newUlid()}`;
    return { sessionId, url: `https://checkout.stripe.example/fake/${sessionId}` };
  }

  constructEvent(): StripeEvent {
    throw new Error("FakeTenantStripeProvider never receives a real webhook body — see /v1/dev/stripe-connect/:siteId/advance instead");
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

/**
 * UNVERIFIED against a live Stripe account (see this module's own
 * comment). Written from Stripe's documented Connect OAuth and Checkout
 * Sessions APIs:
 * https://docs.stripe.com/connect/oauth-standard-accounts
 * https://docs.stripe.com/connect/direct-charges
 * https://docs.stripe.com/api/checkout/sessions/create
 * https://docs.stripe.com/webhooks/signatures
 *
 * Webhook signature verification (`constructEvent`) is copied verbatim
 * from lib/stripe.ts's RealStripeProvider — Stripe's documented
 * `Stripe-Signature` scheme is generic HMAC verification, not specific to
 * which Stripe integration receives it, so there is exactly one correct
 * way to implement it and no reason for this copy to diverge. Hand-rolled
 * rather than the `stripe` npm package, consistent with every other
 * UNVERIFIED adapter in this codebase using plain `fetch`.
 */
export class RealTenantStripeProvider implements TenantStripeProvider {
  constructor(
    /**
     * The PLATFORM's own Stripe secret key (STRIPE_SECRET_KEY, shared with
     * lib/stripe.ts — see .env.example) — doubles as the standard OAuth
     * flow's `client_secret` (Stripe's own docs: the token exchange
     * authenticates with the platform account's secret key, not a
     * separate "Connect client secret", which doesn't exist) and as the
     * direct-charge authentication for `createCheckoutSession`, which
     * authenticates as the platform account and names the connected
     * account via the `Stripe-Account` header, never as the tenant (see
     * CreateCheckoutSessionInput's own comment). STRIPE_CONNECT_CLIENT_ID
     * is deliberately unused here — it only ever appears in the authorize
     * *redirect* URL, which (like every other adapter's `connect`) this
     * class never builds.
     */
    private readonly platformSecretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async connect(input: { authorizationCode: string }): Promise<TenantStripeTokens> {
    const response = await this.fetchImpl("https://connect.stripe.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.authorizationCode,
        client_secret: this.platformSecretKey,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Stripe Connect OAuth token exchange failed (${response.status}): ${body}`);
    }
    const token = (await response.json()) as StripeOAuthTokenResponse;
    return { accessToken: token.access_token, stripeAccountId: token.stripe_user_id };
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    const response = await this.fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.platformSecretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        // Direct charge (https://docs.stripe.com/connect/direct-charges):
        // this header, not the tenant's own access token, is what makes
        // the Checkout Session (and the resulting charge) belong to the
        // connected account while still being created with the
        // platform's own credentials.
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
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Stripe API error (${response.status}): ${body}`);
    }
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

/** Real only when STRIPE_CONNECT_CLIENT_ID/STRIPE_SECRET_KEY are both explicitly configured — unset (the default everywhere, including CI) always returns the fake, same "never by accident" discipline as every sibling factory. STRIPE_SECRET_KEY is the platform's own key, already used by lib/stripe.ts — deliberately not a second credential (see .env.example). */
export function createTenantStripeProvider(env: NodeJS.ProcessEnv = process.env): TenantStripeProvider {
  const connectClientId = env.STRIPE_CONNECT_CLIENT_ID;
  const platformSecretKey = env.STRIPE_SECRET_KEY;
  if (connectClientId && platformSecretKey) {
    return new RealTenantStripeProvider(platformSecretKey);
  }
  return new FakeTenantStripeProvider();
}
