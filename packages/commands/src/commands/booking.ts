import type { Command } from "../registry.js";
import type { Booking, ListBookingsQuery, ListBookingsResult } from "@prefab/api-client";

export const bookingList: Command<{ siteId: string } & ListBookingsQuery, ListBookingsResult> = {
  name: "booking.list",
  description: "List a site's bookings, paginated (Slice 9)",
  run: (ctx, args) => {
    const { siteId, ...query } = args;
    return ctx.api.listBookings(siteId, query);
  },
};

export const bookingCancel: Command<{ siteId: string; bookingId: string }, Booking> = {
  name: "booking.cancel",
  mutation: "booking.cancel",
  description: "Cancel a booking as the site owner — releases the slot and best-effort updates the visitor's calendar invite",
  run: (ctx, args) => ctx.api.cancelBooking(args.siteId, args.bookingId),
};
