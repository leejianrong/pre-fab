import type { SubscriptionProps } from "@prefab/blocks";
import type { PageDocument } from "@prefab/schema";

/** Must match @prefab/blocks' own SUBSCRIPTION_BLOCK_TYPE — see payment-manifest.ts's identical comment for why this is a literal, not an import, from build-worker.ts's fresh-subprocess context. */
const SUBSCRIPTION_BLOCK_TYPE = "subscription";

/**
 * The same shape as @prefab/runtime's `SubscriptionBlockManifest` —
 * duplicated rather than imported, for the identical reason
 * payment-manifest.ts's `PublishSafePaymentBlockManifest` is: @prefab/publish
 * already imports Astro (ADR-0007) and must never become something the
 * self-host runtime has any reason to import.
 */
export interface PublishSafeSubscriptionBlockManifest {
  id: string;
  siteId: string;
  heading: string;
  description: string;
  buttonLabel: string;
  price: number;
  currency: string;
  interval: "month" | "year";
  trialPeriodDays: number;
  successMessage: string;
}

/** Every Subscription block's publish-safe manifest across a set of pages — mirrors extractPublishSafePaymentBlocks exactly. Written into every bundle as `prefab-subscription-blocks.json`. Deliberately excludes `stripe_connections` (the tenant's own OAuth grant) — same reasoning payment-manifest.ts's own comment gives. */
export function extractPublishSafeSubscriptionBlocks(siteId: string, pages: PageDocument[]): PublishSafeSubscriptionBlockManifest[] {
  const blocks: PublishSafeSubscriptionBlockManifest[] = [];
  for (const page of pages) {
    for (const block of page.blocks) {
      if (block.type !== SUBSCRIPTION_BLOCK_TYPE) continue;
      const props = block.props as SubscriptionProps;
      blocks.push({
        id: block.id,
        siteId,
        heading: props.heading,
        description: props.description,
        buttonLabel: props.buttonLabel,
        price: props.price,
        currency: props.currency,
        interval: props.interval,
        trialPeriodDays: props.trialPeriodDays,
        successMessage: props.successMessage,
      });
    }
  }
  return blocks;
}
