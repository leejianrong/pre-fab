import { formatZonedDateTime, generateBookingIcs, type BookingNotifier, type BookingRecord } from "@prefab/runtime";
import type { EmailAttachment, EmailSender } from "./email.js";

/** Self-host's own EmailBookingNotifier — mirrors apps/api/src/lib/booking-notifier.ts exactly (deliberately duplicated, never imported: ADR-0010). */
export class EmailBookingNotifier implements BookingNotifier {
  constructor(
    private readonly sender: EmailSender,
    private readonly manageBaseUrl: string,
  ) {}

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

  private attachment(ics: string): EmailAttachment[] {
    return [{ filename: "booking.ics", content: Buffer.from(ics, "utf8").toString("base64"), contentType: "text/calendar; charset=utf-8; method=REQUEST" }];
  }

  private manageUrl(booking: BookingRecord, siteId: string): string {
    return `${this.manageBaseUrl}/v1/runtime/bookings/${siteId}/${booking.id}/manage?token=${encodeURIComponent(booking.manageToken)}`;
  }

  /** "You're booked for Sep 7, 2026, 4:30 PM (Asia/Singapore)." — never the raw UTC instant a visitor never asked to read (KAN-1259). */
  private visitorLocalTime(booking: BookingRecord): string {
    return `${formatZonedDateTime(new Date(booking.startsAt).getTime(), booking.visitorTimezone)} (${booking.visitorTimezone})`;
  }

  /** Same conversion, in the site owner's own availability-rule timezone rather than the visitor's — the two can differ. */
  private ownerLocalTime(booking: BookingRecord, ownerTimezone: string): string {
    return `${formatZonedDateTime(new Date(booking.startsAt).getTime(), ownerTimezone)} (${ownerTimezone})`;
  }

  async notifyConfirmed(input: Parameters<BookingNotifier["notifyConfirmed"]>[0]): Promise<void> {
    const { booking, siteId, ownerEmail, ownerTimezone } = input;
    const attachments = this.attachment(this.icsFor(booking, "REQUEST", 0));
    await this.sender.send({
      to: booking.visitorEmail,
      subject: "Your booking is confirmed",
      text: `You're booked for ${this.visitorLocalTime(booking)}.\n\nNeed to cancel or reschedule? ${this.manageUrl(booking, siteId)}`,
      attachments,
    });
    if (ownerEmail) {
      await this.sender.send({
        to: ownerEmail,
        subject: `New booking: ${booking.visitorName}`,
        text: `${booking.visitorName} (${booking.visitorEmail}) booked ${this.ownerLocalTime(booking, ownerTimezone)}.\n\n${booking.notes ?? ""}`,
        attachments,
      });
    }
  }

  async notifyCanceled(input: Parameters<BookingNotifier["notifyCanceled"]>[0]): Promise<void> {
    const { booking, ownerEmail, ownerTimezone } = input;
    const attachments = this.attachment(this.icsFor(booking, "CANCEL", 1));
    await this.sender.send({ to: booking.visitorEmail, subject: "Your booking was canceled", text: `Your booking for ${this.visitorLocalTime(booking)} has been canceled.`, attachments });
    if (ownerEmail) {
      await this.sender.send({ to: ownerEmail, subject: `Booking canceled: ${booking.visitorName}`, text: `${booking.visitorName}'s booking for ${this.ownerLocalTime(booking, ownerTimezone)} was canceled.`, attachments });
    }
  }

  async notifyRescheduled(input: Parameters<BookingNotifier["notifyRescheduled"]>[0]): Promise<void> {
    const { booking, siteId, ownerEmail, ownerTimezone } = input;
    const attachments = this.attachment(this.icsFor(booking, "REQUEST", 1));
    await this.sender.send({
      to: booking.visitorEmail,
      subject: "Your booking was rescheduled",
      text: `Your booking has moved to ${this.visitorLocalTime(booking)}.\n\nNeed to change it again? ${this.manageUrl(booking, siteId)}`,
      attachments,
    });
    if (ownerEmail) {
      await this.sender.send({ to: ownerEmail, subject: `Booking rescheduled: ${booking.visitorName}`, text: `${booking.visitorName}'s booking moved to ${this.ownerLocalTime(booking, ownerTimezone)}.`, attachments });
    }
  }
}
