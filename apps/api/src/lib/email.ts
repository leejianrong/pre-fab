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
