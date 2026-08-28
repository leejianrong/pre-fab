import type { FormNotifier } from "@prefab/runtime";
import type { EmailSender } from "./email.js";

/** Adapts an EmailSender (Slice 3's outbox fake, or a real provider) into @prefab/runtime's FormNotifier — the runtime never knows an email provider exists, only that "notify" can succeed or throw. */
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
