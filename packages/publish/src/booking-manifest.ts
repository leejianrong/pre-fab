import type { BookingProps } from "@prefab/blocks";
import type { PageDocument } from "@prefab/schema";

/** Must match @prefab/blocks' own BOOKING_BLOCK_TYPE — see form-manifest.ts's identical comment for why this is a literal, not an import, from build-worker.ts's fresh-subprocess context. */
const BOOKING_BLOCK_TYPE = "booking";

/**
 * The same shape as @prefab/runtime's `BookingWidgetManifest` — duplicated
 * rather than imported, for the identical reason form-manifest.ts's
 * `PublishSafeFormManifest` is: @prefab/publish already imports Astro
 * (ADR-0007) and must never become something the self-host runtime has any
 * reason to import.
 */
export interface PublishSafeBookingWidgetManifest {
  id: string;
  siteId: string;
  heading: string;
  description: string;
  confirmLabel: string;
  successMessage: string;
}

/** Every Booking block's publish-safe manifest across a set of pages — mirrors extractPublishSafeForms exactly. Written into every bundle as `prefab-booking-widgets.json`. */
export function extractPublishSafeBookingWidgets(siteId: string, pages: PageDocument[]): PublishSafeBookingWidgetManifest[] {
  const widgets: PublishSafeBookingWidgetManifest[] = [];
  for (const page of pages) {
    for (const block of page.blocks) {
      if (block.type !== BOOKING_BLOCK_TYPE) continue;
      const props = block.props as BookingProps;
      widgets.push({
        id: block.id,
        siteId,
        heading: props.heading,
        description: props.description,
        confirmLabel: props.confirmLabel,
        successMessage: props.successMessage,
      });
    }
  }
  return widgets;
}
