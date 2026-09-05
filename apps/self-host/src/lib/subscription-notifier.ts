import type { EmailSender } from "./email.js";

/**
 * KAN-1154 part 2 / ADR-0016 (R10) — a trimmed, self-contained duplicate of
 * apps/api/src/lib/subscription-notifier.ts's `EmailSubscriptionNotifier`,
 * same "duplicated, not imported" discipline as every other apps/self-host
 * lib mirroring an apps/api one (turnstile.ts's own comment). No
 * accounts/owner-email-per-site lookup here — same single operator-
 * configured address (`ownerEmail`) every self-host notifier already uses.
 */
export class EmailSubscriptionNotifier {
  constructor(private readonly sender: EmailSender) {}

  async notifyStarted(input: { ownerEmail: string; price: number; currency: string; interval: "month" | "year"; trialing: boolean; buyerEmail: string | null }): Promise<void> {
    const formatted = `${(input.price / 100).toFixed(2)} ${input.currency.toUpperCase()}/${input.interval}`;
    const trialNote = input.trialing ? " (trial started)" : "";
    await this.sender.send({
      to: input.ownerEmail,
      subject: "You have a new subscriber",
      text: `A visitor started a subscription of ${formatted}${trialNote}${input.buyerEmail ? ` (${input.buyerEmail})` : ""}.`,
    });
  }

  async notifyRecovered(input: { ownerEmail: string; buyerEmail: string | null }): Promise<void> {
    await this.sender.send({
      to: input.ownerEmail,
      subject: "A subscription payment recovered",
      text: `A subscriber's previously-failed payment has now succeeded — their subscription is active again${input.buyerEmail ? ` (${input.buyerEmail})` : ""}.`,
    });
  }

  async notifyPastDue(input: { ownerEmail: string; buyerEmail: string | null }): Promise<void> {
    await this.sender.send({
      to: input.ownerEmail,
      subject: "A subscription payment failed",
      text: `A subscriber's payment failed and their subscription is now past due${input.buyerEmail ? ` (${input.buyerEmail})` : ""}. Stripe's own dunning/retry schedule will keep trying.`,
    });
  }

  async notifyCanceled(input: { ownerEmail: string; buyerEmail: string | null }): Promise<void> {
    await this.sender.send({
      to: input.ownerEmail,
      subject: "A subscription was canceled",
      text: `A subscriber's subscription has been canceled${input.buyerEmail ? ` (${input.buyerEmail})` : ""}.`,
    });
  }
}
