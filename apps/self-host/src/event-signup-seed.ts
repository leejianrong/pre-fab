import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SelfHostDb } from "./db.js";

interface PublishSafeEventSignupManifest {
  id: string;
  siteId: string;
  heading: string;
  fields: unknown[];
  capacity: number | null;
  waitlistEnabled: boolean;
  submitLabel: string;
}

/** Mirrors forms-seed.ts's seedFormsFromBundle exactly — this instance's whole "publish" step for EventSignup blocks, idempotent (upsert) across restarts and re-exports. */
export async function seedEventSignupWidgetsFromBundle(db: SelfHostDb, bundleDir: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(path.join(bundleDir, "prefab-event-signups.json"), "utf8");
  } catch {
    return 0; // no event sign-up widgets in this bundle — nothing to seed, not an error
  }
  const widgets: PublishSafeEventSignupManifest[] = JSON.parse(raw);

  const upsert = db.prepare(
    `INSERT INTO event_signup_widgets (id, site_id, heading, fields, capacity, waitlist_enabled, submit_label)
     VALUES (@id, @siteId, @heading, @fields, @capacity, @waitlistEnabled, @submitLabel)
     ON CONFLICT (id) DO UPDATE SET
       site_id = excluded.site_id,
       heading = excluded.heading,
       fields = excluded.fields,
       capacity = excluded.capacity,
       waitlist_enabled = excluded.waitlist_enabled,
       submit_label = excluded.submit_label`,
  );

  for (const widget of widgets) {
    upsert.run({
      id: widget.id,
      siteId: widget.siteId,
      heading: widget.heading,
      fields: JSON.stringify(widget.fields),
      capacity: widget.capacity,
      waitlistEnabled: widget.waitlistEnabled ? 1 : 0,
      submitLabel: widget.submitLabel,
    });
  }
  return widgets.length;
}
