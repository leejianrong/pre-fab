/**
 * Same shape as apps/api/src/lib/email.ts (deliberately duplicated, not
 * imported — see turnstile.ts's own comment on why): a console/log sender
 * by default, so a self-hosted instance with no mail provider configured
 * still stores every submission (R7.4) and simply never emails the owner
 * about it, and a real provider adapter behind the same one-method
 * interface for an operator who configures one.
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

/** Logs to stdout — visible in `docker logs`, which is the whole point for a self-hosted instance with no mail provider configured. */
export function createConsoleEmailSender(): EmailSender {
  return {
    async send(message) {
      const entry: EmailMessage = { ...message, sentAt: new Date().toISOString() };
      console.log(`[self-host email] to=${entry.to} subject="${entry.subject}"\n${entry.text}`);
    },
  };
}

/**
 * UNVERIFIED against a live Resend account — written from Resend's
 * documented REST API (https://resend.com/docs/api-reference/emails/send-email),
 * same caveat apps/api/src/lib/email.ts's own ResendEmailSender carries.
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

/** Real Resend only when both are explicitly set — see this package's README. */
export function createEmailSender(env: NodeJS.ProcessEnv = process.env): EmailSender {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM_ADDRESS;
  if (apiKey && from) return new ResendEmailSender(apiKey, from);
  return createConsoleEmailSender();
}
