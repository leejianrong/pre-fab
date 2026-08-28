import { useEffect, useState } from "react";
import { ApiClientError, type PageDocument, type Submission } from "@prefab/api-client";
import { api } from "./api.js";

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
    <div role="dialog" aria-label="Form submissions" style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.4)", display: "flex", justifyContent: "flex-end", zIndex: 50 }}>
      <div style={{ width: "480px", maxWidth: "100%", height: "100%", background: "white", overflowY: "auto", padding: "1rem", fontFamily: "system-ui, sans-serif", boxShadow: "-2px 0 12px rgba(0,0,0,0.1)" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.125rem", margin: 0, flex: 1 }}>{selectedFormId ? "Submissions" : "Forms"}</h2>
          <button onClick={onClose} aria-label="Close submissions panel" style={{ border: "none", background: "none", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        {formBlocks.length === 0 ? (
          <p style={{ color: "#64748b", fontSize: "0.875rem" }}>This page has no Form block yet — add one from the block library, publish, and submissions will show up here.</p>
        ) : !selectedFormId ? (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
            {formBlocks.map((block) => (
              <li key={block.id}>
                <button
                  onClick={() => setSelectedFormId(block.id)}
                  style={{ width: "100%", textAlign: "left", padding: "0.6rem", border: "1px solid #e2e8f0", borderRadius: "0.5rem", background: "white", cursor: "pointer" }}
                >
                  {(block.props as { heading?: string }).heading || "Untitled form"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <FormSubmissions
            siteId={siteId}
            formId={selectedFormId}
            onBack={formBlocks.length > 1 ? () => setSelectedFormId(null) : undefined}
          />
        )}
      </div>
    </div>
  );
}

function FormSubmissions({ siteId, formId, onBack }: { siteId: string; formId: string; onBack?: () => void }) {
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [busySubmissionId, setBusySubmissionId] = useState<string | null>(null);

  async function refresh() {
    const [fws, list] = await Promise.all([api.getForm(siteId, formId), api.listSubmissions(siteId, formId)]);
    setSubmissions(list.submissions);
    setNotifyEmail(fws.settings?.notifyEmail ?? "");
    setWebhookUrl(fws.settings?.webhookUrl ?? "");
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
    <div>
      {onBack ? (
        <button onClick={onBack} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, marginBottom: "0.75rem", color: "#4f46e5" }}>
          ← All forms
        </button>
      ) : null}

      <form onSubmit={saveSettings} style={{ display: "grid", gap: "0.5rem", marginBottom: "1.25rem", border: "1px solid #e2e8f0", borderRadius: "0.5rem", padding: "0.75rem" }}>
        <h3 style={{ fontSize: "0.9375rem", margin: 0 }}>Notifications</h3>
        <label style={{ fontSize: "0.8125rem", color: "#475569" }}>
          Notify email
          <input
            type="email"
            placeholder="you@example.com"
            value={notifyEmail}
            onChange={(e) => setNotifyEmail(e.target.value)}
            style={{ display: "block", width: "100%", boxSizing: "border-box", padding: "0.4rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem", marginTop: "0.2rem" }}
          />
        </label>
        <label style={{ fontSize: "0.8125rem", color: "#475569" }}>
          Webhook URL
          <input
            type="url"
            placeholder="https://..."
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            style={{ display: "block", width: "100%", boxSizing: "border-box", padding: "0.4rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem", marginTop: "0.2rem" }}
          />
        </label>
        <button type="submit" disabled={savingSettings} style={{ padding: "0.4rem", background: "#4f46e5", color: "white", border: "none", borderRadius: "0.375rem" }}>
          {savingSettings ? "Saving…" : "Save"}
        </button>
      </form>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <button onClick={exportCsv} style={{ padding: "0.3rem 0.6rem", fontSize: "0.8125rem" }}>
          Export CSV
        </button>
        <button onClick={exportJson} style={{ padding: "0.3rem 0.6rem", fontSize: "0.8125rem" }}>
          Export JSON
        </button>
      </div>

      {error ? <p style={{ color: "#dc2626", fontSize: "0.8125rem" }}>{error}</p> : null}

      {submissions === null ? (
        <p>Loading…</p>
      ) : submissions.length === 0 ? (
        <p style={{ color: "#64748b", fontSize: "0.875rem" }}>No submissions yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {submissions.map((submission) => (
            <li key={submission.id} style={{ border: "1px solid #e2e8f0", borderRadius: "0.5rem", padding: "0.6rem" }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: "0.3rem" }}>
                <span style={{ fontSize: "0.75rem", color: "#64748b", flex: 1 }}>{new Date(submission.createdAt).toLocaleString()}</span>
                {submission.notifyStatus === "failed" ? (
                  <span style={{ fontSize: "0.75rem", color: "#dc2626" }} title={submission.notifyError ?? undefined}>
                    email failed
                  </span>
                ) : null}
              </div>
              <dl style={{ margin: "0 0 0.4rem 0", fontSize: "0.8125rem" }}>
                {Object.entries(submission.values).map(([key, value]) => (
                  <div key={key} style={{ display: "flex", gap: "0.4rem" }}>
                    <dt style={{ color: "#64748b", minWidth: "5rem" }}>{key}</dt>
                    <dd style={{ margin: 0, wordBreak: "break-word" }}>{String(value)}</dd>
                  </div>
                ))}
              </dl>
              <button
                onClick={() => remove(submission.id)}
                disabled={busySubmissionId === submission.id}
                style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", color: "#dc2626" }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
