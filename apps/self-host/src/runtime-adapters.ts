import type { FormManifestStore, FormSettings, FormSettingsStore, SubmissionStore } from "@prefab/runtime";
import type { SelfHostDb } from "./db.js";

/**
 * SQLite-backed halves of @prefab/runtime's storage interfaces (ADR-0010) —
 * the exact same interfaces apps/api/src/lib/runtime-adapters.ts implements
 * against Postgres. `submitForm` (packages/runtime/src/submit.ts) runs
 * completely unchanged against these; only what's behind the interface
 * differs. No tenant context needed here at all — a self-hosted instance
 * serves exactly one site, so there is nothing to isolate from.
 */
export function createSqliteFormManifestStore(db: SelfHostDb): FormManifestStore {
  return {
    async getForm(formId) {
      const row = db
        .prepare<[string], { id: string; site_id: string; heading: string; fields: string; submit_label: string; turnstile_enabled: number }>(
          "SELECT id, site_id, heading, fields, submit_label, turnstile_enabled FROM forms WHERE id = ?",
        )
        .get(formId);
      if (!row) return null;
      return {
        id: row.id,
        siteId: row.site_id,
        heading: row.heading,
        fields: JSON.parse(row.fields),
        submitLabel: row.submit_label,
        turnstileEnabled: row.turnstile_enabled === 1,
      };
    },
  };
}

export function createSqliteFormSettingsStore(db: SelfHostDb): FormSettingsStore {
  return {
    async getSettings(formId): Promise<FormSettings | null> {
      const row = db
        .prepare<[string], { notify_email: string | null; webhook_url: string | null; webhook_secret: string | null }>(
          "SELECT notify_email, webhook_url, webhook_secret FROM form_settings WHERE form_id = ?",
        )
        .get(formId);
      if (!row) return { notifyEmail: null, webhookUrl: null, webhookSecret: null };
      return { notifyEmail: row.notify_email, webhookUrl: row.webhook_url, webhookSecret: row.webhook_secret };
    },
  };
}

export function createSqliteSubmissionStore(db: SelfHostDb): SubmissionStore {
  return {
    async create(input) {
      const createdAt = new Date().toISOString();
      db.prepare(
        "INSERT INTO submissions (id, site_id, form_id, values_json, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(input.id, input.siteId, input.formId, JSON.stringify(input.values), input.ip, createdAt);
      return { id: input.id, createdAt };
    },
    async setNotifyStatus(submissionId, _siteId, status, error) {
      db.prepare("UPDATE submissions SET notify_status = ?, notify_error = ? WHERE id = ?").run(status, error, submissionId);
    },
  };
}
