/**
 * A minimal send-only adapter, deliberately behind one interface so a real
 * provider can be swapped in later without touching a caller (the same
 * shape Slice 6's ASSUMED note describes for form notifications — "Resend
 * or Postmark behind a one-interface adapter"). Slice 3 only needs to get a
 * verification code to an inbox; Slice 6 is where a production provider
 * lands behind this same `EmailSender`.
 *
 * The outbox this default sender writes to also backs the dev-only
 * `/v1/dev/emails` endpoint in app.ts — the same "dev-only bootstrap, not a
 * product mutation" pattern `/v1/dev/login` already uses, so e2e and local
 * dev can read a sent code without a real inbox.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

export interface EmailSender {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export function createOutboxEmailSender(): { sender: EmailSender; outbox: EmailMessage[] } {
  const outbox: EmailMessage[] = [];
  return {
    outbox,
    sender: {
      async send(message) {
        const entry: EmailMessage = { ...message, sentAt: new Date().toISOString() };
        outbox.push(entry);
        console.log(`[email] to=${entry.to} subject="${entry.subject}"\n${entry.text}`);
      },
    },
  };
}

/**
 * Slice 6 lands the production provider this module's own comment above
 * promised. UNVERIFIED against a live Resend account (same discipline as
 * domain-provider.ts's CloudflareDomainProvider) — written from Resend's
 * documented REST API (https://resend.com/docs/api-reference/emails/send-email),
 * never exercised against real credentials in this environment.
 */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    const response = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: message.to, subject: message.subject, text: message.text }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Resend send failed (${response.status}): ${body}`);
    }
  }
}

/**
 * Real Resend only when both RESEND_API_KEY and RESEND_FROM_ADDRESS are
 * explicitly configured — the same "never by accident" discipline as
 * createDomainProvider. `fallback` is what every test and unconfigured
 * environment gets instead (typically the same outbox sender signup's
 * verification codes already use, so /v1/dev/emails keeps working for
 * form-notification emails too in dev and e2e).
 */
export function createEmailSender(fallback: EmailSender, env: NodeJS.ProcessEnv = process.env): EmailSender {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM_ADDRESS;
  if (apiKey && from) return new ResendEmailSender(apiKey, from);
  return fallback;
}
