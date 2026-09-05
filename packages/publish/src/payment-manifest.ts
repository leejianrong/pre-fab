import type { PaymentProps } from "@prefab/blocks";
import type { PageDocument } from "@prefab/schema";

/** Must match @prefab/blocks' own PAYMENT_BLOCK_TYPE — see form-manifest.ts's identical comment for why this is a literal, not an import, from build-worker.ts's fresh-subprocess context. */
const PAYMENT_BLOCK_TYPE = "payment";

/**
 * The same shape as @prefab/runtime's `PaymentBlockManifest` — duplicated
 * rather than imported, for the identical reason form-manifest.ts's
 * `PublishSafeFormManifest` is: @prefab/publish already imports Astro
 * (ADR-0007) and must never become something the self-host runtime has any
 * reason to import.
 */
export interface PublishSafePaymentBlockManifest {
  id: string;
  siteId: string;
  heading: string;
  description: string;
  buttonLabel: string;
  amount: number;
  currency: string;
  successMessage: string;
}

/** Every Payment block's publish-safe manifest across a set of pages — mirrors extractPublishSafeBookingWidgets exactly. Written into every bundle as `prefab-payment-blocks.json`. Deliberately excludes `stripe_connections` (the tenant's own OAuth grant) — that's credential-shaped, platform/operator-configured state, never portable page content, the same reasoning `calendar_connections` is never written into a bundle either. */
export function extractPublishSafePaymentBlocks(siteId: string, pages: PageDocument[]): PublishSafePaymentBlockManifest[] {
  const blocks: PublishSafePaymentBlockManifest[] = [];
  for (const page of pages) {
    for (const block of page.blocks) {
      if (block.type !== PAYMENT_BLOCK_TYPE) continue;
      const props = block.props as PaymentProps;
      blocks.push({
        id: block.id,
        siteId,
        heading: props.heading,
        description: props.description,
        buttonLabel: props.buttonLabel,
        amount: props.amount,
        currency: props.currency,
        successMessage: props.successMessage,
      });
    }
  }
  return blocks;
}
