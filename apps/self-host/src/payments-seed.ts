import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SelfHostDb } from "./db.js";

interface PublishSafePaymentBlockManifest {
  id: string;
  siteId: string;
  heading: string;
  description: string;
  buttonLabel: string;
  amount: number;
  currency: string;
  successMessage: string;
}

/** Mirrors forms-seed.ts's/booking-seed.ts's own seed function exactly — this instance's whole "publish" step for Payment blocks, idempotent (upsert) across restarts and re-exports. */
export async function seedPaymentBlocksFromBundle(db: SelfHostDb, bundleDir: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(path.join(bundleDir, "prefab-payment-blocks.json"), "utf8");
  } catch {
    return 0;
  }
  const blocks: PublishSafePaymentBlockManifest[] = JSON.parse(raw);

  const upsert = db.prepare(
    `INSERT INTO payment_blocks (id, site_id, heading, description, button_label, amount, currency, success_message)
     VALUES (@id, @siteId, @heading, @description, @buttonLabel, @amount, @currency, @successMessage)
     ON CONFLICT (id) DO UPDATE SET
       site_id = excluded.site_id,
       heading = excluded.heading,
       description = excluded.description,
       button_label = excluded.button_label,
       amount = excluded.amount,
       currency = excluded.currency,
       success_message = excluded.success_message`,
  );
  for (const block of blocks) upsert.run(block);
  return blocks.length;
}
