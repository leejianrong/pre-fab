import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SelfHostDb } from "./db.js";

interface PublishSafeSubscriptionBlockManifest {
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

/** Mirrors payments-seed.ts's own seed function exactly (KAN-1154 / ADR-0016) — this instance's whole "publish" step for Subscription blocks, idempotent (upsert) across restarts and re-exports. */
export async function seedSubscriptionBlocksFromBundle(db: SelfHostDb, bundleDir: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(path.join(bundleDir, "prefab-subscription-blocks.json"), "utf8");
  } catch {
    return 0;
  }
  const blocks: PublishSafeSubscriptionBlockManifest[] = JSON.parse(raw);

  const upsert = db.prepare(
    `INSERT INTO subscription_blocks (id, site_id, heading, description, button_label, price, currency, interval, trial_period_days, success_message)
     VALUES (@id, @siteId, @heading, @description, @buttonLabel, @price, @currency, @interval, @trialPeriodDays, @successMessage)
     ON CONFLICT (id) DO UPDATE SET
       site_id = excluded.site_id,
       heading = excluded.heading,
       description = excluded.description,
       button_label = excluded.button_label,
       price = excluded.price,
       currency = excluded.currency,
       interval = excluded.interval,
       trial_period_days = excluded.trial_period_days,
       success_message = excluded.success_message`,
  );
  for (const block of blocks) upsert.run(block);
  return blocks.length;
}
