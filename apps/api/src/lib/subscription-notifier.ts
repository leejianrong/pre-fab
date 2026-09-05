import type { EmailSender } from "./email.js";

/**
 * KAN-1154 part 2 / ADR-0016: the subscription counterpart to
 * payment-notifier.ts's `EmailPaymentNotifier` — same minimal, best-effort,
 * non-blocking shape (every call site does `.catch(() => {})`, never
 * `await`s a failure into the webhook response), but three narrow methods
 * instead of one, because a subscription's lifecycle has three moments an
 * owner plausibly wants to hear about (a one-off payment only ever has
 * one: it completed). Not a @prefab/runtime port, for the identical reason
 * EmailPaymentNotifier isn't: this is a plain apps/api-only concern, called
 * directly from the webhook/dev-advance route handlers.
 */
export class EmailSubscriptionNotifier {
  constructor(private readonly sender: EmailSender) {}

  /** checkout.session.completed → active or trialing. */
  async notifyStarted(input: { ownerEmail: string; price: number; currency: string; interval: "month" | "year"; trialing: boolean; buyerEmail: string | null }): Promise<void> {
    const formatted = `${(input.price / 100).toFixed(2)} ${input.currency.toUpperCase()}/${input.interval}`;
    const trialNote = input.trialing ? " (trial started)" : "";
    await this.sender.send({
      to: input.ownerEmail,
      subject: "You have a new subscriber",
      text: `A visitor started a subscription of ${formatted}${trialNote}${input.buyerEmail ? ` (${input.buyerEmail})` : ""}.`,
    });
  }

  /** past_due -> active (invoice.paid recovering a subscription dunning had put at risk). Distinct from notifyStarted — this subscriber isn't new, they nearly churned and didn't. */
  async notifyRecovered(input: { ownerEmail: string; buyerEmail: string | null }): Promise<void> {
    await this.sender.send({
      to: input.ownerEmail,
      subject: "A subscription payment recovered",
      text: `A subscriber's previously-failed payment has now succeeded — their subscription is active again${input.buyerEmail ? ` (${input.buyerEmail})` : ""}.`,
    });
  }

  /** invoice.payment_failed, or a trial's first invoice failing → past_due. */
  async notifyPastDue(input: { ownerEmail: string; buyerEmail: string | null }): Promise<void> {
    await this.sender.send({
      to: input.ownerEmail,
      subject: "A subscription payment failed",
      text: `A subscriber's payment failed and their subscription is now past due${input.buyerEmail ? ` (${input.buyerEmail})` : ""}. Stripe's own dunning/retry schedule will keep trying.`,
    });
  }

  /** customer.subscription.deleted (or a dunning-exhausted customer.subscription.updated) → canceled. */
  async notifyCanceled(input: { ownerEmail: string; buyerEmail: string | null }): Promise<void> {
    await this.sender.send({
      to: input.ownerEmail,
      subject: "A subscription was canceled",
      text: `A subscriber's subscription has been canceled${input.buyerEmail ? ` (${input.buyerEmail})` : ""}.`,
    });
  }
}
