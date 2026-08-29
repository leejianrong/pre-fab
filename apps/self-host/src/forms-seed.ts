import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SelfHostDb } from "./db.js";

interface PublishSafeFormManifest {
  id: string;
  siteId: string;
  heading: string;
  fields: unknown[];
  submitLabel: string;
  turnstileEnabled: boolean;
}

/**
 * Seeds the `forms` table from a bundle's own `prefab-forms.json`
 * (@prefab/publish's build-worker.ts writes this into every bundle) — the
 * self-host runtime's whole "publish" step, since there is no control
 * plane here to snapshot a form's manifest into a database the way
 * apps/api's publish.create route does. Idempotent (upsert), so restarting
 * against the same bundle — or re-running after re-exporting a changed
 * site — never duplicates a row. Never touches `form_settings`: R20 keeps
 * notifyEmail/webhookUrl/webhookSecret out of a site source tree
 * entirely, so those are configured locally by the operator (see this
 * package's README), never seeded from a bundle.
 */
export async function seedFormsFromBundle(db: SelfHostDb, bundleDir: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(path.join(bundleDir, "prefab-forms.json"), "utf8");
  } catch {
    return 0; // no forms in this bundle — nothing to seed, not an error
  }
  const forms: PublishSafeFormManifest[] = JSON.parse(raw);

  const upsert = db.prepare(
    `INSERT INTO forms (id, site_id, heading, fields, submit_label, turnstile_enabled)
     VALUES (@id, @siteId, @heading, @fields, @submitLabel, @turnstileEnabled)
     ON CONFLICT (id) DO UPDATE SET
       site_id = excluded.site_id,
       heading = excluded.heading,
       fields = excluded.fields,
       submit_label = excluded.submit_label,
       turnstile_enabled = excluded.turnstile_enabled`,
  );

  for (const form of forms) {
    upsert.run({
      id: form.id,
      siteId: form.siteId,
      heading: form.heading,
      fields: JSON.stringify(form.fields),
      submitLabel: form.submitLabel,
      turnstileEnabled: form.turnstileEnabled ? 1 : 0,
    });
  }
  return forms.length;
}
