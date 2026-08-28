import type { PoolClient } from "pg";

export type NotifyStatus = "skipped" | "sent" | "failed";

export interface Submission {
  id: string;
  siteId: string;
  formId: string;
  values: Record<string, unknown>;
  ip: string | null;
  notifyStatus: NotifyStatus;
  notifyError: string | null;
  createdAt: Date;
}

interface RawSubmissionRow {
  id: string;
  site_id: string;
  form_id: string;
  values: Record<string, unknown>;
  ip: string | null;
  notify_status: NotifyStatus;
  notify_error: string | null;
  created_at: Date;
}

function rowToSubmission(row: RawSubmissionRow): Submission {
  return {
    id: row.id,
    siteId: row.site_id,
    formId: row.form_id,
    values: row.values,
    ip: row.ip,
    notifyStatus: row.notify_status,
    notifyError: row.notify_error,
    createdAt: row.created_at,
  };
}

/**
 * The one write no visitor request may ever fail to make once validation,
 * rate-limiting and Turnstile have already passed (R7.4) — notification
 * and webhook delivery are separate steps layered on top, never a
 * precondition for this insert.
 */
export async function createSubmission(
  client: PoolClient,
  input: { id: string; siteId: string; formId: string; values: Record<string, unknown>; ip: string | null },
): Promise<Submission> {
  const result = await client.query<RawSubmissionRow>(
    `INSERT INTO submissions (id, site_id, form_id, values, ip) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.id, input.siteId, input.formId, JSON.stringify(input.values), input.ip],
  );
  return rowToSubmission(result.rows[0]!);
}

export async function setSubmissionNotifyStatus(
  client: PoolClient,
  submissionId: string,
  status: NotifyStatus,
  error: string | null,
): Promise<void> {
  await client.query(`UPDATE submissions SET notify_status = $1, notify_error = $2 WHERE id = $3`, [
    status,
    error,
    submissionId,
  ]);
}

export interface ListSubmissionsOptions {
  /** Clamped to [1, 200]. Default 50. */
  limit?: number;
  /** Clamped to >= 0. Default 0. */
  offset?: number;
}

export interface ListSubmissionsResult {
  submissions: Submission[];
  total: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function listSubmissions(
  client: PoolClient,
  siteId: string,
  formId: string,
  options: ListSubmissionsOptions = {},
): Promise<ListSubmissionsResult> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));

  const countResult = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM submissions WHERE site_id = $1 AND form_id = $2`,
    [siteId, formId],
  );
  const rowsResult = await client.query<RawSubmissionRow>(
    `SELECT * FROM submissions WHERE site_id = $1 AND form_id = $2 ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
    [siteId, formId, limit, offset],
  );

  return { submissions: rowsResult.rows.map(rowToSubmission), total: Number(countResult.rows[0]!.count) };
}

/** Every submission for a form, unpaginated — CSV/JSON export needs the whole set, not a page of it. */
export async function listAllSubmissionsForExport(client: PoolClient, siteId: string, formId: string): Promise<Submission[]> {
  const result = await client.query<RawSubmissionRow>(
    `SELECT * FROM submissions WHERE site_id = $1 AND form_id = $2 ORDER BY created_at DESC, id DESC`,
    [siteId, formId],
  );
  return result.rows.map(rowToSubmission);
}

export async function getSubmission(client: PoolClient, siteId: string, submissionId: string): Promise<Submission | null> {
  const result = await client.query<RawSubmissionRow>(`SELECT * FROM submissions WHERE site_id = $1 AND id = $2`, [
    siteId,
    submissionId,
  ]);
  return result.rows[0] ? rowToSubmission(result.rows[0]) : null;
}

/** Per-record deletion for PDPA/GDPR (SLICES.md Slice 6). */
export async function deleteSubmission(client: PoolClient, siteId: string, submissionId: string): Promise<void> {
  await client.query(`DELETE FROM submissions WHERE site_id = $1 AND id = $2`, [siteId, submissionId]);
}
