import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Subscription, subscriptionBlockDefinition, subscriptionDefaultProps, SubscriptionPropsSchema } from "../src/index.js";

describe("Subscription block", () => {
  it("server-renders with react-dom/server — proof it never touches window/document (ADR-0004 SSR-safety)", () => {
    const html = renderToStaticMarkup(createElement(Subscription, subscriptionDefaultProps));
    expect(html).toContain(subscriptionDefaultProps.heading);
    expect(html).toContain('data-pf-block-type="subscription"');
  });

  it("renders the static shell (no runtimeApiUrl) with a message rather than a live subscribe button", () => {
    const html = renderToStaticMarkup(createElement(Subscription, subscriptionDefaultProps));
    expect(html).toContain("Subscriptions are available once this page is published.");
  });

  it("references theme tokens via CSS custom properties, never a raw value (invariant 2)", () => {
    const html = renderToStaticMarkup(
      createElement(Subscription, { ...subscriptionDefaultProps, runtimeApiUrl: "https://api.example.com", blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }),
    );
    expect(html).toMatch(/var\(--pf-color-accent\)/);
    expect(html).toMatch(/var\(--pf-color-foreground\)/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(html).not.toMatch(/rgba?\(/);
  });

  it("formats the price from cents-per-interval using the configured currency and interval", () => {
    const html = renderToStaticMarkup(createElement(Subscription, { ...subscriptionDefaultProps, price: 2599, currency: "usd", interval: "month" }));
    expect(html).toMatch(/\$25\.99\/month/);
  });

  it("formats a yearly interval correctly", () => {
    const html = renderToStaticMarkup(createElement(Subscription, { ...subscriptionDefaultProps, price: 10000, currency: "usd", interval: "year" }));
    expect(html).toMatch(/\$100\.00\/year/);
  });

  it("shows a trial callout only when trialPeriodDays is greater than 0", () => {
    const withTrial = renderToStaticMarkup(createElement(Subscription, { ...subscriptionDefaultProps, trialPeriodDays: 14 }));
    expect(withTrial).toContain("14-day free trial");
    const withoutTrial = renderToStaticMarkup(createElement(Subscription, { ...subscriptionDefaultProps, trialPeriodDays: 0 }));
    expect(withoutTrial).not.toContain("free trial");
  });

  it("shows the live subscribe button once runtimeApiUrl/blockId are present", () => {
    const html = renderToStaticMarkup(
      createElement(Subscription, { ...subscriptionDefaultProps, runtimeApiUrl: "https://api.example.com", blockId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }),
    );
    expect(html).toContain(subscriptionDefaultProps.buttonLabel);
    expect(html).not.toContain("Subscriptions are available once this page is published.");
  });

  it("props schema rejects an unrecognised field", () => {
    const result = SubscriptionPropsSchema.safeParse({ ...subscriptionDefaultProps, amount: 1000 });
    expect(result.success).toBe(false);
  });

  it("props schema rejects a non-positive price", () => {
    expect(SubscriptionPropsSchema.safeParse({ ...subscriptionDefaultProps, price: 0 }).success).toBe(false);
    expect(SubscriptionPropsSchema.safeParse({ ...subscriptionDefaultProps, price: -100 }).success).toBe(false);
  });

  it("props schema rejects an uppercase or non-3-letter currency code", () => {
    expect(SubscriptionPropsSchema.safeParse({ ...subscriptionDefaultProps, currency: "USD" }).success).toBe(false);
    expect(SubscriptionPropsSchema.safeParse({ ...subscriptionDefaultProps, currency: "us" }).success).toBe(false);
  });

  it("props schema rejects an interval other than month/year", () => {
    expect(SubscriptionPropsSchema.safeParse({ ...subscriptionDefaultProps, interval: "week" }).success).toBe(false);
  });

  it("props schema rejects an out-of-range trialPeriodDays", () => {
    expect(SubscriptionPropsSchema.safeParse({ ...subscriptionDefaultProps, trialPeriodDays: -1 }).success).toBe(false);
    expect(SubscriptionPropsSchema.safeParse({ ...subscriptionDefaultProps, trialPeriodDays: 366 }).success).toBe(false);
  });

  it("props schema defaults trialPeriodDays to 0 when omitted", () => {
    const { trialPeriodDays: _omit, ...rest } = subscriptionDefaultProps;
    const result = SubscriptionPropsSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.trialPeriodDays).toBe(0);
  });

  it("registers at version 1 with no gaps in its migration chain", () => {
    expect(subscriptionBlockDefinition.version).toBe(1);
    expect(Object.keys(subscriptionBlockDefinition.migrations)).toHaveLength(0);
  });
});
