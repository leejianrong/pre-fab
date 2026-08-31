import { computeAvailableSlots, type Slot } from "./slots.js";
import { resolveBusyTimes } from "./busy.js";
import type { AvailabilityRuleManifest, AvailabilityStore, BookingStore, BookingWidgetManifest, BookingWidgetStore, CalendarSyncPort } from "./booking-types.js";

export interface ListSlotsInput {
  widgetId: string;
  rangeStartMs: number;
  rangeEndMs: number;
  now?: number;
}

export type ListSlotsOutcome =
  | { status: "ok"; slots: Slot[]; widget: BookingWidgetManifest; rule: AvailabilityRuleManifest; calendarSyncOk: boolean }
  | { status: "widget_not_found" }
  | { status: "rule_not_found" };

/** The runtime API's read side of scheduling — what the Booking block's slot picker calls to render available times in the visitor's own timezone (the caller converts each returned UTC instant into the visitor's local rendering; this function only ever deals in UTC milliseconds). */
export async function listAvailableSlots(
  input: ListSlotsInput,
  deps: { widgets: BookingWidgetStore; availability: AvailabilityStore; bookings: BookingStore; calendarSync: CalendarSyncPort },
): Promise<ListSlotsOutcome> {
  const widget = await deps.widgets.getWidget(input.widgetId);
  if (!widget) return { status: "widget_not_found" };

  const rule = await deps.availability.getRule(widget.siteId);
  if (!rule) return { status: "rule_not_found" };

  const { busy, calendarSyncOk } = await resolveBusyTimes(deps, widget.siteId, input.rangeStartMs, input.rangeEndMs);
  const slots = computeAvailableSlots({ rule, rangeStartMs: input.rangeStartMs, rangeEndMs: input.rangeEndMs, busy, now: input.now });

  return { status: "ok", slots, widget, rule, calendarSyncOk };
}
