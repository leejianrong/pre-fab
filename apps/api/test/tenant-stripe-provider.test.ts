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
