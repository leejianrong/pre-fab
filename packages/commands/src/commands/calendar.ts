import type { Command } from "../registry.js";
import type { CalendarConnectionStatus, ConnectCalendarInput } from "@prefab/api-client";

export const calendarConnect: Command<{ siteId: string } & ConnectCalendarInput, CalendarConnectionStatus> = {
  name: "calendar.connect",
  mutation: "calendar.connect",
  description: "Connect a site's Google Calendar or Microsoft 365 calendar for two-way sync (Slice 9) — real providers need a pre-obtained OAuth authorizationCode",
  run: (ctx, args) => {
    const { siteId, ...input } = args;
    return ctx.api.connectCalendar(siteId, input);
  },
};

export const calendarDisconnect: Command<{ siteId: string }, { removed: true }> = {
  name: "calendar.disconnect",
  mutation: "calendar.disconnect",
  description: "Disconnect a site's calendar sync",
  run: (ctx, args) => ctx.api.disconnectCalendar(args.siteId),
};

export const calendarStatus: Command<{ siteId: string }, CalendarConnectionStatus | null> = {
  name: "calendar.status",
  description: "Get a site's calendar connection status — provider, connected/error, and the last sync error if any",
  run: (ctx, args) => ctx.api.getCalendarStatus(args.siteId),
};
