import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FakeTenantStripeProvider, RealTenantStripeProvider } from "../src/lib/tenant-stripe-provider.js";

describe("FakeTenantStripeProvider", () => {
  it("connect() synthesizes a fresh access token and connected account id every time", async () => {
    const provider = new FakeTenantStripeProvider();
    const a = await provider.connect({ authorizationCode: "code-a" });
    const b = await provider.connect({ authorizationCode: "code-b" });
    expect(a.accessToken).not.toBe(b.accessToken);
    expect(a.stripeAccountId).not.toBe(b.stripeAccountId);
    expect(a.stripeAccountId).toMatch(/^fake-acct-/);
  });

  it("createCheckoutSession synthesizes a distinct session id and url every time", async () => {
    const provider = new FakeTenantStripeProvider();
    const input = {
      accessToken: "fake-access",
      stripeAccountId: "fake-acct",
      amount: 1000,
      currency: "usd",
      productName: "Widget",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      paymentRecordId: "rec-1",
      siteId: "site-1",
    };
    const a = await provider.createCheckoutSession(input);
    const b = await provider.createCheckoutSession(input);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.url).toContain(a.sessionId);
  });

  it("constructEvent always throws — there is no real webhook body to verify against a fake provider", () => {
    const provider = new FakeTenantStripeProvider();
    expect(() => provider.constructEvent(Buffer.from("{}"), "t=1,v1=abc", "secret")).toThrow();
  });

  it("createCartCheckoutSession (KAN-1245 / ADR-0018 cart addendum) synthesizes a distinct session id and url every time", async () => {
    const provider = new FakeTenantStripeProvider();
    const input = {
      accessToken: "fake-access",
      stripeAccountId: "fake-acct",
      items: [{ unitAmount: 1500, currency: "usd", title: "Mug", quantity: 2 }],
      currency: "usd",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      cartCheckoutRecordId: "rec-1",
      siteId: "site-1",
      requiresShipping: false,
      shipping: { flatRateAmount: 500, label: "Standard shipping", allowedCountries: ["US"] },
    };
    const a = await provider.createCartCheckoutSession(input);
    const b = await provider.createCartCheckoutSession(input);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.url).toContain(a.sessionId);
  });
});

describe("RealTenantStripeProvider.createCartCheckoutSession (KAN-1245 / ADR-0018 cart addendum)", () => {
  function makeFetch() {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ id: "cs_test", url: "https://checkout.stripe.com/cs_test" }), { status: 200 });
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  it("builds one line_items[N] per cart line, and omits shipping fields when requiresShipping is false", async () => {
    const { calls, fetchImpl } = makeFetch();
    const provider = new RealTenantStripeProvider("sk_test_platform", fetchImpl);
    const session = await provider.createCartCheckoutSession({
      accessToken: "unused",
      stripeAccountId: "acct_123",
      items: [
        { unitAmount: 1500, currency: "usd", title: "Mug", quantity: 2 },
        { unitAmount: 900, currency: "usd", title: "E-book", quantity: 1 },
      ],
      currency: "usd",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      cartCheckoutRecordId: "rec-1",
      siteId: "site-1",
      requiresShipping: false,
      shipping: { flatRateAmount: 500, label: "Standard shipping", allowedCountries: ["US"] },
    });

    expect(session).toEqual({ sessionId: "cs_test", url: "https://checkout.stripe.com/cs_test" });
    const body = calls[0]!.body;
    expect(body).toContain("mode=payment");
    expect(body).toContain("client_reference_id=rec-1");
    expect(body).toContain("metadata%5BcheckoutType%5D=cart");
    expect(body).toContain("metadata%5BsiteId%5D=site-1");
    expect(body).toContain("metadata%5BcartCheckoutRecordId%5D=rec-1");
    expect(body).toContain("line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=1500");
    expect(body).toContain("line_items%5B0%5D%5Bquantity%5D=2");
    expect(body).toContain("line_items%5B1%5D%5Bprice_data%5D%5Bunit_amount%5D=900");
    expect(body).toContain("line_items%5B1%5D%5Bquantity%5D=1");
    expect(body).not.toContain("shipping_options");
    expect(body).not.toContain("shipping_address_collection");
  });

  it("sends shipping_address_collection/shipping_options only when requiresShipping is true", async () => {
    const { calls, fetchImpl } = makeFetch();
    const provider = new RealTenantStripeProvider("sk_test_platform", fetchImpl);
    await provider.createCartCheckoutSession({
      accessToken: "unused",
      stripeAccountId: "acct_123",
      items: [{ unitAmount: 1500, currency: "usd", title: "Mug", quantity: 1 }],
      currency: "usd",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      cartCheckoutRecordId: "rec-1",
      siteId: "site-1",
      requiresShipping: true,
      shipping: { flatRateAmount: 500, label: "Standard shipping", allowedCountries: ["US", "CA"] },
    });

    const body = calls[0]!.body;
    expect(body).toContain("shipping_address_collection%5Ballowed_countries%5D%5B0%5D=US");
    expect(body).toContain("shipping_address_collection%5Ballowed_countries%5D%5B1%5D=CA");
    expect(body).toContain("shipping_options%5B0%5D%5Bshipping_rate_data%5D%5Btype%5D=fixed_amount");
    expect(body).toContain("shipping_options%5B0%5D%5Bshipping_rate_data%5D%5Bfixed_amount%5D%5Bamount%5D=500");
    expect(body).toContain("shipping_options%5B0%5D%5Bshipping_rate_data%5D%5Bfixed_amount%5D%5Bcurrency%5D=usd");
  });
});

describe("RealTenantStripeProvider.constructEvent (webhook signature verification)", () => {
  function sign(payload: string, secret: string, timestamp: number): string {
    const signedPayload = `${timestamp}.${payload}`;
    const signature = createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
    return `t=${timestamp},v1=${signature}`;
  }

  it("accepts a correctly signed payload and parses it, including the Connect-specific `account` field", () => {
    const provider = new RealTenantStripeProvider("sk_test_platform");
    const secret = "whsec_test";
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } }, account: "acct_123" });
    const signature = sign(body, secret, Math.floor(Date.now() / 1000));

    const event = provider.constructEvent(Buffer.from(body), signature, secret);
    expect(event.id).toBe("evt_1");
    expect(event.type).toBe("checkout.session.completed");
    expect(event.account).toBe("acct_123");
  });

  it("rejects a payload signed with the wrong secret", () => {
    const provider = new RealTenantStripeProvider("sk_test_platform");
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: {} } });
    const signature = sign(body, "wrong-secret", Math.floor(Date.now() / 1000));

    expect(() => provider.constructEvent(Buffer.from(body), signature, "whsec_test")).toThrow(/verification failed/);
  });

  it("rejects a missing signature header", () => {
    const provider = new RealTenantStripeProvider("sk_test_platform");
    expect(() => provider.constructEvent(Buffer.from("{}"), undefined, "whsec_test")).toThrow(/missing/);
  });

  it("rejects a malformed signature header", () => {
    const provider = new RealTenantStripeProvider("sk_test_platform");
    expect(() => provider.constructEvent(Buffer.from("{}"), "not-a-valid-header", "whsec_test")).toThrow(/malformed/);
  });
});
