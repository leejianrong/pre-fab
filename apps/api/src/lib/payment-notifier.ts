import type { EmailSender } from "./email.js";

/** Sent to the site owner once a Checkout session actually completes (real webhook or dev-advance) — mirrors form-notifier.ts's own minimal shape exactly. Not a @prefab/runtime port: this is a plain apps/api-only concern, called directly from the webhook/dev-advance route handlers rather than threaded through createPaymentCheckout (which only ever creates a *pending* session — there is nothing to notify about yet at that point). */
export class EmailPaymentNotifier {
  constructor(private readonly sender: EmailSender) {}

  async notifyCompleted(input: { ownerEmail: string; amount: number; currency: string; buyerEmail: string | null }): Promise<void> {
    const formatted = `${(input.amount / 100).toFixed(2)} ${input.currency.toUpperCase()}`;
    await this.sender.send({
      to: input.ownerEmail,
      subject: "You've been paid",
      text: `A visitor completed a payment of ${formatted}${input.buyerEmail ? ` (${input.buyerEmail})` : ""}.`,
    });
  }
}
