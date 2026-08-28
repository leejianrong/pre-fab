import {
  createSubmission,
  getFormPublic,
  getFormSettings,
  setSubmissionNotifyStatus,
  withTenantContext,
  type Pool,
} from "@prefab/db";
import type { FormManifestStore, FormSettingsStore, SubmissionStore } from "@prefab/runtime";

/**
 * The Postgres-backed halves of @prefab/runtime's storage interfaces
 * (ADR-0010) — apps/api is the control plane, so it's the one place
 * allowed to know these are backed by Postgres and @prefab/db at all.
 * Slice 7's self-host runtime implements these exact same three
 * interfaces against SQLite instead.
 */
export function createPostgresFormManifestStore(pool: Pool): FormManifestStore {
  return {
    // No tenant context: this is the runtime's own public submit path,
    // resolving a formId with no signed-in principal — see
    // `forms_public_read`'s RLS policy (0006_slice6.sql).
    async getForm(formId) {
      return withTenantContext(pool, {}, (client) => getFormPublic(client, formId));
    },
  };
}

export function createPostgresFormSettingsStore(pool: Pool): FormSettingsStore {
  return {
    async getSettings(formId, siteId) {
      return withTenantContext(pool, { siteId }, (client) => getFormSettings(client, siteId, formId));
    },
  };
}

export function createPostgresSubmissionStore(pool: Pool): SubmissionStore {
  return {
    async create(input) {
      const record = await withTenantContext(pool, { siteId: input.siteId }, (client) =>
        createSubmission(client, { id: input.id, siteId: input.siteId, formId: input.formId, values: input.values, ip: input.ip }),
      );
      return { id: record.id, createdAt: record.createdAt.toISOString() };
    },
    async setNotifyStatus(submissionId, siteId, status, error) {
      await withTenantContext(pool, { siteId }, (client) => setSubmissionNotifyStatus(client, submissionId, status, error));
    },
  };
}
