import { useEffect, useRef, useState } from "react";
import { ApiClientError, type CustomDomainStatus, type DomainWithInstruction } from "@prefab/api-client";
import { api } from "./api.js";

const STATUS_LABEL: Record<CustomDomainStatus, string> = {
  pending_dns: "Pending DNS",
  active: "Active",
  failed: "Failed",
};

const STATUS_COLOR: Record<CustomDomainStatus, string> = {
  pending_dns: "#b45309",
  active: "#16a34a",
  failed: "#dc2626",
};

/**
 * SLICES.md Slice 4: "Domain status surfaced in the dashboard, with
 * actionable errors" + "a DNS walkthrough that a non-technical owner can
 * follow." Verification is lazy/on-demand (apps/api's `domain.verify`) —
 * this panel polls it itself while anything is still `pending_dns`, so an
 * owner watching the screen sees it flip to Active without a manual
 * refresh, without this repo needing a background job queue.
 */
export function DomainsPanel({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const [domains, setDomains] = useState<DomainWithInstruction[] | null>(null);
  const [hostname, setHostname] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyDomainId, setBusyDomainId] = useState<string | null>(null);

  async function refresh() {
    setDomains(await api.listDomains(siteId));
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const domainsRef = useRef(domains);
  domainsRef.current = domains;

  useEffect(() => {
    const interval = setInterval(() => {
      const pending = (domainsRef.current ?? []).filter((d) => d.domain.status === "pending_dns");
      if (pending.length === 0) return;
      Promise.all(pending.map((d) => api.verifyDomain(siteId, d.domain.id))).then(refresh).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submitAdd(event: React.FormEvent) {
    event.preventDefault();
    setAdding(true);
    setError(null);
    try {
      await api.addDomain(siteId, hostname);
      setHostname("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function checkNow(domainId: string) {
    setBusyDomainId(domainId);
    try {
      await api.verifyDomain(siteId, domainId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyDomainId(null);
    }
  }

  async function remove(domainId: string) {
    setBusyDomainId(domainId);
    try {
      await api.removeDomain(siteId, domainId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyDomainId(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Custom domains"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.4)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: "440px",
          maxWidth: "100%",
          height: "100%",
          background: "white",
          overflowY: "auto",
          padding: "1rem",
          fontFamily: "system-ui, sans-serif",
          boxShadow: "-2px 0 12px rgba(0,0,0,0.1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.125rem", margin: 0, flex: 1 }}>Domains</h2>
          <button onClick={onClose} aria-label="Close domains panel" style={{ border: "none", background: "none", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        {domains === null ? (
          <p>Loading…</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.25rem 0", display: "grid", gap: "0.75rem" }}>
            {domains.map(({ domain, dnsInstruction }) => (
              <li key={domain.id} style={{ border: "1px solid #e2e8f0", borderRadius: "0.5rem", padding: "0.75rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                  <strong style={{ flex: 1, wordBreak: "break-all" }}>{domain.hostname}</strong>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: STATUS_COLOR[domain.status],
                      border: `1px solid ${STATUS_COLOR[domain.status]}`,
                      borderRadius: "9999px",
                      padding: "0.1rem 0.5rem",
                    }}
                  >
                    {STATUS_LABEL[domain.status]}
                  </span>
                </div>

                {domain.status !== "active" ? (
                  <div style={{ fontSize: "0.8125rem", color: "#475569", background: "#f8fafc", borderRadius: "0.375rem", padding: "0.5rem", marginBottom: "0.4rem" }}>
                    <p style={{ margin: "0 0 0.25rem 0" }}>
                      Add a <strong>{dnsInstruction.recordType}</strong> record: name <code>{dnsInstruction.name}</code>, value{" "}
                      <code>{dnsInstruction.value}</code>.
                    </p>
                    <p style={{ margin: 0, color: "#64748b" }}>{dnsInstruction.note}</p>
                  </div>
                ) : null}

                {domain.verificationError ? (
                  <p style={{ fontSize: "0.8125rem", color: "#dc2626", margin: "0 0 0.4rem 0" }}>{domain.verificationError}</p>
                ) : null}

                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {domain.status !== "active" ? (
                    <button
                      onClick={() => checkNow(domain.id)}
                      disabled={busyDomainId === domain.id}
                      style={{ padding: "0.3rem 0.6rem", fontSize: "0.8125rem" }}
                    >
                      {busyDomainId === domain.id ? "Checking…" : "Check now"}
                    </button>
                  ) : null}
                  <button
                    onClick={() => remove(domain.id)}
                    disabled={busyDomainId === domain.id}
                    style={{ padding: "0.3rem 0.6rem", fontSize: "0.8125rem", color: "#dc2626" }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submitAdd} style={{ display: "grid", gap: "0.5rem", marginBottom: "1.25rem" }}>
          <h3 style={{ fontSize: "0.9375rem", margin: 0 }}>Add a domain</h3>
          <input
            placeholder="www.yourbusiness.com"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            style={{ padding: "0.5rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem" }}
          />
          <button
            type="submit"
            disabled={adding || hostname.trim() === ""}
            style={{ padding: "0.5rem", background: "#4f46e5", color: "white", border: "none", borderRadius: "0.375rem" }}
          >
            {adding ? "Adding…" : "Add domain"}
          </button>
          {error ? <p style={{ color: "#dc2626", fontSize: "0.8125rem" }}>{error}</p> : null}
        </form>

        <details style={{ fontSize: "0.8125rem", color: "#475569" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>How do I add a DNS record?</summary>
          <ol style={{ paddingLeft: "1.1rem", display: "grid", gap: "0.3rem", margin: "0.5rem 0 0 0" }}>
            <li>Log in to whoever you bought your domain from (e.g. GoDaddy, Namecheap, Google Domains, Cloudflare).</li>
            <li>Find the "DNS" or "DNS management" section for your domain.</li>
            <li>Add a new record using the type, name and value shown above for your domain.</li>
            <li>Save — DNS changes can take a few minutes to an hour to take effect. This page checks automatically.</li>
          </ol>
        </details>
      </div>
    </div>
  );
}
