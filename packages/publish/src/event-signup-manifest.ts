import type { EventSignupProps } from "@prefab/blocks";
import type { PageDocument } from "@prefab/schema";

/**
 * Deliberately not imported from @prefab/blocks at runtime (only the
 * `EventSignupProps` type above is, which is erased at build time) —
 * build-worker.ts is a fresh subprocess whose own comment explains why
 * (see form-manifest.ts's identical comment). Must match @prefab/blocks'
 * own EVENTSIGNUP_BLOCK_TYPE.
 */
const EVENTSIGNUP_BLOCK_TYPE = "eventsignup";

/**
 * The same shape as @prefab/runtime's `EventSignupWidgetManifest`
 * (packages/runtime/src/event-signup-types.ts) — duplicated rather than
 * imported, for the identical reason form-manifest.ts's
 * `PublishSafeFormManifest` is: @prefab/publish already imports Astro
 * (ADR-0007) and must never become something the self-host runtime (a
 * @prefab/runtime consumer, containment-checked against control-plane
 * packages) has any reason to import.
 */
export interface PublishSafeEventSignupManifest {
  id: string;
  siteId: string;
  heading: string;
  fields: EventSignupProps["fields"];
  capacity: number | null;
  waitlistEnabled: boolean;
  submitLabel: string;
}

/**
 * Every EventSignup block's publish-safe manifest across a set of pages —
 * exactly the fields apps/api's publish.create route snapshots into
 * @prefab/db's `event_signup_widgets` table (mirrors extractPublishSafeForms
 * exactly). Written into every bundle by build-worker.ts as
 * `prefab-event-signups.json`, so a bundle carries everything the self-host
 * runtime needs to seed its own event-signups store with no separate
 * publish step.
 */
export function extractPublishSafeEventSignups(siteId: string, pages: PageDocument[]): PublishSafeEventSignupManifest[] {
  const widgets: PublishSafeEventSignupManifest[] = [];
  for (const page of pages) {
    for (const block of page.blocks) {
      if (block.type !== EVENTSIGNUP_BLOCK_TYPE) continue;
      const props = block.props as EventSignupProps;
      widgets.push({
        id: block.id,
        siteId,
        heading: props.heading,
        fields: props.fields,
        capacity: props.capacity,
        waitlistEnabled: props.waitlistEnabled,
        submitLabel: props.submitLabel,
      });
    }
  }
  return widgets;
}
