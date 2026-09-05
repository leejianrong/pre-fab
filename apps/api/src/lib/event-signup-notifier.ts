import type { EventSignupNotifier } from "@prefab/runtime";
import type { EmailSender } from "./email.js";

/** Adapts an EmailSender into @prefab/runtime's EventSignupNotifier — the runtime never knows an email provider exists, only that "notify" can succeed or throw. Mirrors form-notifier.ts's EmailFormNotifier exactly (owner-only — see event-signup-types.ts's own comment on why there's no reliable visitor address to notify). */
export class EmailEventSignupNotifier implements EventSignupNotifier {
  constructor(private readonly sender: EmailSender) {}

  async notify(input: Parameters<EventSignupNotifier["notify"]>[0]): Promise<void> {
    const lines = Object.entries(input.signup.values)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    const statusLine = input.signup.status === "confirmed" ? "confirmed" : `waitlisted (position ${input.signup.position})`;
    await this.sender.send({
      to: input.ownerEmail,
      subject: input.signup.status === "confirmed" ? "New event sign-up" : "New event waitlist sign-up",
      text: `A visitor signed up for your event — ${statusLine}.\n\n${lines}`,
    });
  }
}
