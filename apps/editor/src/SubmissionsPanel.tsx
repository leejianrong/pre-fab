import { useEffect, useState } from "react";
import { ApiClientError, type PageDocument, type Submission, type WebhookDelivery } from "@prefab/api-client";
import { api } from "./api.js";
import { Card, FilledButton, OutlinedButton, SideSheet, StatusBadge, TextButton, TextField } from "./ui/index.js";

/** Mirrors PaymentsPanel's PAYMENT_STATUS_TONE — same three-tone vocabulary (StatusBadge.tsx) applied to a delivery's own status. */
const DELIVERY_STATUS_TONE: Record<WebhookDelivery["status"], "positive" | "neutral" | "negative"> = {
  success: "positive",
  pending: "neutral",
  failed: "negative",
};

/**
 * SLICES.md Slice 6 demo: "the owner... sees the submission in their
 * dashboard, exports it as CSV." No standalone "list forms for a site"
 * endpoint exists — the editor already has the current page's block tree
 * in memory (the same data SiteEditor loaded for the Puck canvas), and a
 * Form block's own id *is* its formId (see @prefab/db's forms table), so
 * this panel finds every form by scanning `page.blocks` rather than
 * introducing a fourth surface just for a dashboard convenience.
 */
export function SubmissionsPanel({ siteId, page, onClose }: { siteId: string; page: PageDocument; onClose: () => void }) {
  const formBlocks = page.blocks.filter((b) => b.type === "form");
  const [selectedFormId, setSelectedFormId] = useState<string | null>(formBlocks.length === 1 ? formBlocks[0]!.id : null);

  return (
    <SideSheet
      title={selectedFormId ? "Submissions" : "Forms"}
      ariaLabel="Form submissions"
      closeLabel="Close submissions panel"
      onClose={onClose}
      width={480}
    >
      {formBlocks.length === 0 ? (
        <p className="pf-supporting-text">This page has no Form block yet — add one from the block library, publish, and submissions will show up here.</p>
      ) : !selectedFormId ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {formBlocks.map((block) => (
            <li key={block.id}>
              <Card interactive onClick={() => setSelectedFormId(block.id)} style={{ padding: "0.6rem" }}>
                {(block.props as { heading?: string }).heading || "Untitled form"}
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <FormSubmissions siteId={siteId} formId={selectedFormId} onBack={formBlocks.length > 1 ? () => setSelectedFormId(null) : undefined} />
      )}
    </SideSheet>
  );
}

function FormSubmissions({ siteId, formId, onBack }: { siteId: string; formId: string; onBack?: () => void }) {
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [busySubmissionId, setBusySubmissionId] = useState<string | null>(null);

  async function refresh() {
    const [fws, list, deliveryList] = await Promise.all([
      api.getForm(siteId, formId),
      api.listSubmissions(siteId, formId),
      api.listWebhookDeliveries(siteId, formId, { limit: 20 }),
    ]);
    setSubmissions(list.submissions);
    setNotifyEmail(fws.settings?.notifyEmail ?? "");
    setWebhookUrl(fws.settings?.webhookUrl ?? "");
    setWebhookSecret(fws.settings?.webhookSecret ?? "");
    setDeliveries(deliveryList.deliveries);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [siteId, formId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    setSavingSettings(true);
    setError(null);
    try {
      await api.configureForm(siteId, formId, {
        notifyEmail: notifyEmail.trim() === "" ? null : notifyEmail.trim(),
        webhookUrl: webhookUrl.trim() === "" ? null : webhookUrl.trim(),
        webhookSecret: webhookSecret.trim() === "" ? null : webhookSecret.trim(),
      });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSettings(false);
    }
  }

  async function remove(submissionId: string) {
    setBusySubmissionId(submissionId);
    try {
      await api.deleteSubmission(siteId, formId, submissionId);
      setSubmissions((prev) => prev?.filter((s) => s.id !== submissionId) ?? prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySubmissionId(null);
    }
  }

  function downloadFile(filename: string, contents: string, contentType: string) {
    const blob = new Blob([contents], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportCsv() {
    downloadFile(`${formId}-submissions.csv`, await api.exportSubmissionsCsv(siteId, formId), "text/csv");
  }

  async function exportJson() {
    downloadFile(`${formId}-submissions.json`, JSON.stringify(await api.exportSubmissionsJson(siteId, formId), null, 2), "application/json");
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {onBack ? (
        <TextButton onClick={onBack} style={{ justifySelf: "start" }}>
          ← All forms
        </TextButton>
      ) : null}

      <Card style={{ display: "grid", gap: "0.5rem" }}>
        <form onSubmit={saveSettings} style={{ display: "grid", gap: "0.5rem" }}>
          <h3 className="pf-subsection-title">Notifications</h3>
          <TextField label="Notify email" type="email" placeholder="you@example.com" value={notifyEmail} onChange={setNotifyEmail} />
          <TextField label="Webhook URL" type="url" placeholder="https://…" value={webhookUrl} onChange={setWebhookUrl} />
          <TextField
            label="Webhook secret"
            type="password"
            placeholder="Optional — sent as the x-prefab-webhook-secret header"
            value={webhookSecret}
            onChange={setWebhookSecret}
            supportingText="Lets your receiving endpoint verify a delivery really came from pre-fab."
          />
          <FilledButton type="submit" disabled={savingSettings}>
            {savingSettings ? "Saving…" : "Save"}
          </FilledButton>
        </form>
      </Card>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <OutlinedButton onClick={exportCsv}>Export CSV</OutlinedButton>
        <OutlinedButton onClick={exportJson}>Export JSON</OutlinedButton>
      </div>

      {error ? <p className="pf-error-text">{error}</p> : null}

      {webhookUrl.trim() !== "" || (deliveries !== null && deliveries.length > 0) ? (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <h3 className="pf-subsection-title">Webhook deliveries</h3>
          {deliveries === null ? (
            <p className="pf-supporting-text">Loading…</p>
          ) : deliveries.length === 0 ? (
            <p className="pf-supporting-text">No delivery attempts yet — one appears here the next time this form is submitted.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
              {deliveries.map((delivery) => (
                <li key={delivery.id}>
                  <Card style={{ padding: "0.6rem", display: "grid", gap: "0.3rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <StatusBadge tone={DELIVERY_STATUS_TONE[delivery.status]}>{delivery.status}</StatusBadge>
                      <span className="pf-supporting-text" style={{ flex: 1 }}>
                        {delivery.attempt} attempt{delivery.attempt === 1 ? "" : "s"}
                      </span>
                      <span className="pf-supporting-text" style={{ margin: 0 }}>
                        {new Date(delivery.deliveredAt ?? delivery.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {delivery.status === "pending" ? (
                      <span className="pf-supporting-text" style={{ margin: 0 }}>
                        Next retry {new Date(delivery.nextAttemptAt).toLocaleString()}
                      </span>
                    ) : null}
                    {delivery.lastError ? (
                      <span className="pf-error-text" style={{ margin: 0, wordBreak: "break-word" }}>
                        {delivery.lastError}
                      </span>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {submissions === null ? (
        <p className="pf-supporting-text">Loading…</p>
      ) : submissions.length === 0 ? (
        <p className="pf-supporting-text">No submissions yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {submissions.map((submission) => (
            <li key={submission.id}>
              <Card style={{ padding: "0.6rem" }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: "0.3rem" }}>
                  <span className="pf-supporting-text" style={{ flex: 1 }}>
                    {new Date(submission.createdAt).toLocaleString()}
                  </span>
                  {submission.notifyStatus === "failed" ? (
                    <span className="pf-error-text" title={submission.notifyError ?? undefined}>
                      email failed
                    </span>
                  ) : null}
                </div>
                <dl style={{ margin: "0 0 0.4rem 0" }} className="pf-supporting-text">
                  {Object.entries(submission.values).map(([key, value]) => (
                    <div key={key} style={{ display: "flex", gap: "0.4rem" }}>
                      <dt style={{ minWidth: "5rem" }}>{key}</dt>
                      <dd style={{ margin: 0, wordBreak: "break-word", color: "var(--md-sys-color-on-surface)" }}>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
                <TextButton className="pf-destructive-button" onClick={() => remove(submission.id)} disabled={busySubmissionId === submission.id}>
                  Delete
                </TextButton>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
