import type { Command } from "../registry.js";
import type { EventSignupWidget, ListEventSignupsQuery, ListEventSignupsResult } from "@prefab/api-client";

export const eventSignupWidgetGet: Command<{ siteId: string; widgetId: string }, EventSignupWidget> = {
  name: "eventSignupWidget.get",
  description: "Get an event sign-up widget's published manifest (heading/fields/capacity/waitlist) — field definitions and capacity live in the block itself, edited via page.write",
  run: (ctx, args) => ctx.api.getEventSignupWidget(args.siteId, args.widgetId),
};

export const eventSignupList: Command<{ siteId: string; widgetId: string } & ListEventSignupsQuery, ListEventSignupsResult> = {
  name: "eventSignup.list",
  description: "List an event sign-up widget's sign-ups, paginated",
  run: (ctx, args) => {
    const { siteId, widgetId, ...query } = args;
    return ctx.api.listEventSignups(siteId, widgetId, query);
  },
};

export const eventSignupExport: Command<{ siteId: string; widgetId: string; format?: "csv" | "json" }, string> = {
  name: "eventSignup.export",
  description: "Export an event sign-up widget's sign-ups as CSV or JSON (default CSV)",
  run: async (ctx, args) => {
    if (args.format === "json") return JSON.stringify(await ctx.api.exportEventSignupsJson(args.siteId, args.widgetId), null, 2);
    return ctx.api.exportEventSignupsCsv(args.siteId, args.widgetId);
  },
};

export const eventSignupDelete: Command<{ siteId: string; widgetId: string; signupId: string }, { removed: true }> = {
  name: "eventSignup.delete",
  mutation: "eventSignup.delete",
  description: "Delete a single event sign-up — PDPA/GDPR per-record deletion",
  run: (ctx, args) => ctx.api.deleteEventSignup(args.siteId, args.widgetId, args.signupId),
};
