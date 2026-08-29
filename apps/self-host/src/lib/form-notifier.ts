import type { FormNotifier } from "@prefab/runtime";
import type { EmailSender } from "./email.js";

/** Same as apps/api/src/lib/form-notifier.ts — see turnstile.ts's comment on why this is duplicated rather than imported. */
export class EmailFormNotifier implements FormNotifier {
  constructor(private readonly sender: EmailSender) {}

  async notify(input: Parameters<FormNotifier["notify"]>[0]): Promise<void> {
    const lines = Object.entries(input.values)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    await this.sender.send({
      to: input.notifyEmail,
      subject: "New form submission",
      text: `A visitor submitted your form.\n\n${lines}`,
    });
  }
}
