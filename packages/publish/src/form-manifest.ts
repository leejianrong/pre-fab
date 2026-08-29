import type { FormProps } from "@prefab/blocks";
import type { PageDocument } from "@prefab/schema";

/**
 * Deliberately not imported from @prefab/blocks at runtime (only the
 * `FormProps` type above is, which is erased at build time) — build-worker.ts
 * is a fresh subprocess whose own comment explains why: it sets `NODE_ENV`
 * before anything else runs so Astro's dynamically-`import()`ed
 * react-dom-server never collides with a dev-mode React pulled in earlier.
 * A *static* import of `@prefab/blocks` here would pull React in via ESM's
 * mandatory import hoisting — which resolves before that NODE_ENV
 * assignment executes, whatever line it's written on — reintroducing
 * exactly that collision. Must match @prefab/blocks' own FORM_BLOCK_TYPE.
 */
const FORM_BLOCK_TYPE = "form";

/**
 * The same shape as @prefab/runtime's `FormManifest` (packages/runtime/src/
 * types.ts) — duplicated rather than imported, because @prefab/publish
 * already imports Astro (ADR-0007) and must never become something the
 * self-host runtime (a @prefab/runtime consumer, containment-checked
 * against control-plane packages) has any reason to import. Structural
 * typing means apps/self-host's own FormManifestStore can hand this JSON
 * straight to submitForm with no shared nominal type required.
 */
export interface PublishSafeFormManifest {
  id: string;
  siteId: string;
  heading: string;
  fields: FormProps["fields"];
  submitLabel: string;
  turnstileEnabled: boolean;
}

/**
 * Every Form block's publish-safe manifest across a set of pages — exactly
 * the fields apps/api's publish.create route snapshots into @prefab/db's
 * `forms` table (see app.ts's own comment on why notifyEmail/webhookUrl/
 * webhookSecret are never here: R20, those live in `form_settings` /
 * are operator-configured locally in self-host, never in a site source
 * tree). Written into every bundle by build-worker.ts as
 * `prefab-forms.json`, so a bundle carries everything the self-host
 * runtime needs to seed its own forms store with no separate publish step.
 */
export function extractPublishSafeForms(siteId: string, pages: PageDocument[]): PublishSafeFormManifest[] {
  const forms: PublishSafeFormManifest[] = [];
  for (const page of pages) {
    for (const block of page.blocks) {
      if (block.type !== FORM_BLOCK_TYPE) continue;
      const props = block.props as FormProps;
      forms.push({
        id: block.id,
        siteId,
        heading: props.heading,
        fields: props.fields,
        submitLabel: props.submitLabel,
        turnstileEnabled: props.turnstileEnabled,
      });
    }
  }
  return forms;
}
