import { generateBookingIcs, type BookingNotifier, type BookingRecord } from "@prefab/runtime";
import type { EmailSender } from "./email.js";

/**
 * Adapts an EmailSender into @prefab/runtime's BookingNotifier — the
 * runtime never knows an email provider or ICS format exists, only that
 * "notify" can succeed or throw (mirrors form-notifier.ts's
 * EmailFormNotifier exactly). "Both parties get a calendar invite"
 * (SLICES.md) means every notify call sends up to two emails: one to the
 * visitor (always, they just booked/canceled/moved something) and one to
 * the owner (when `ownerEmail` resolved to one) — both carry the identical
 * ICS attachment, so both sides' calendar apps agree on the same event.
 */
export class EmailBookingNotifier implements BookingNotifier {
  constructor(private readonly sender: EmailSender) {}

  private icsFor(booking: BookingRecord, method: "REQUEST" | "CANCEL", sequence: number): string {
    return generateBookingIcs({
      uid: `booking-${booking.id}@prefab.app`,
      startsAtMs: new Date(booking.startsAt).getTime(),
      endsAtMs: new Date(booking.endsAt).getTime(),
      summary: `Booking with ${booking.visitorName}`,
      description: booking.notes ?? "",
      organizerEmail: "bookings@prefab.app",
      attendeeEmail: booking.visitorEmail,
      attendeeName: booking.visitorName,
      method,
      sequence,
    });
  }

  private attachment(ics: string) {
    return [{ filename: "booking.ics", content: Buffer.from(ics, "utf8").toString("base64"), contentType: "text/calendar; charset=utf-8; method=REQUEST" }];
  }

  /** One page handles both actions (booking-manage-page.ts) — a single link, never two, is what actually goes in the email. */
  private manageUrl(booking: BookingRecord, siteId: string, manageBaseUrl: string): string {
    return `${manageBaseUrl}/v1/runtime/bookings/${siteId}/${booking.id}/manage?token=${encodeURIComponent(booking.manageToken)}`;
  }

  async notifyConfirmed(input: Parameters<BookingNotifier["notifyConfirmed"]>[0]): Promise<void> {
    const { booking, siteId, ownerEmail, manageBaseUrl } = input;
    const ics = this.icsFor(booking, "REQUEST", 0);
    const manageUrl = this.manageUrl(booking, siteId, manageBaseUrl);

    await this.sender.send({
      to: booking.visitorEmail,
      subject: "Your booking is confirmed",
      text: `You're booked for ${booking.startsAt}.\n\nNeed to cancel or reschedule? ${manageUrl}`,
      attachments: this.attachment(ics),
    });

    if (ownerEmail) {
      await this.sender.send({
        to: ownerEmail,
        subject: `New booking: ${booking.visitorName}`,
        text: `${booking.visitorName} (${booking.visitorEmail}) booked ${booking.startsAt}.\n\n${booking.notes ?? ""}`,
        attachments: this.attachment(ics),
      });
    }
  }

  async notifyCanceled(input: Parameters<BookingNotifier["notifyCanceled"]>[0]): Promise<void> {
    const { booking, ownerEmail } = input;
    const ics = this.icsFor(booking, "CANCEL", 1);

    await this.sender.send({
      to: booking.visitorEmail,
      subject: "Your booking was canceled",
      text: `Your booking for ${booking.startsAt} has been canceled.`,
      attachments: this.attachment(ics),
    });

    if (ownerEmail) {
      await this.sender.send({
        to: ownerEmail,
        subject: `Booking canceled: ${booking.visitorName}`,
        text: `${booking.visitorName}'s booking for ${booking.startsAt} was canceled.`,
        attachments: this.attachment(ics),
      });
    }
  }

  async notifyRescheduled(input: Parameters<BookingNotifier["notifyRescheduled"]>[0]): Promise<void> {
    const { booking, siteId, ownerEmail, manageBaseUrl } = input;
    const ics = this.icsFor(booking, "REQUEST", 1);
    const manageUrl = this.manageUrl(booking, siteId, manageBaseUrl);

    await this.sender.send({
      to: booking.visitorEmail,
      subject: "Your booking was rescheduled",
      text: `Your booking has moved to ${booking.startsAt}.\n\nNeed to change it again? ${manageUrl}`,
      attachments: this.attachment(ics),
    });

    if (ownerEmail) {
      await this.sender.send({
        to: ownerEmail,
        subject: `Booking rescheduled: ${booking.visitorName}`,
        text: `${booking.visitorName}'s booking moved to ${booking.startsAt}.`,
        attachments: this.attachment(ics),
      });
    }
  }
}
