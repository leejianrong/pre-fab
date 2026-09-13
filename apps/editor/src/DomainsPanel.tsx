import { useEffect, useRef, useState } from "react";
import { ApiClientError, type CustomDomainStatus, type DomainWithInstruction } from "@prefab/api-client";
import { api } from "./api.js";
import { Card, FilledButton, OutlinedButton, SideSheet, StatusBadge, TextButton, TextField } from "./ui/index.js";

/**
 * KAN-1267: `addDomain` failing with the API's `plan_required` code
 * (apps/api/src/app.ts's `throw planRequired(...)`, ~line 1553) used to
 * render as the same plain `pf-error-text` every other error gets, with no
 * way forward except the CLI's own `prefab plan upgrade`. Tracked
 * separately from the generic `error` string below so only this one error
 * shape gets the actionable "Upgrade to Pro" button in its place.
 */
type AddDomainError = { kind: "plan_required"; message: string } | { kind: "other"; message: string };

const STATUS_LABEL: Record<CustomDomainStatus, string> = {
  pending_dns: "Pending DNS",
  active: "Active",
  failed: "Failed",
};

const STATUS_TONE: Record<CustomDomainStatus, "positive" | "neutral" | "negative"> = {
  pending_dns: "neutral",
  active: "positive",
  failed: "negative",
};

/**
 * SLICES.md Slice 4: "Domain status surfaced in the dashboard, with
 * actionable errors" + "a DNS walkthrough that a non-technical owner can
 * follow." Verification is lazy/on-demand (apps/api's `domain.verify`) —
 * this panel polls it itself while anything is still `pending_dns`, so an
 * owner watching the screen sees it flip to Active without a manual
 * refresh, without this repo needing a background job queue.
 */
export function DomainsPanel({
  siteId,
  publicUrl,
  onClose,
  onOpenBilling,
}: {
  siteId: string;
  /**
   * KAN-1253: the site's free default address (`https://<slug>.<platformHost>`),
   * already unauthenticated and live the moment the site is first
   * published — passed down from SiteEditor's `site.publicUrl` (GET
   * /v1/sites/:siteId) rather than refetched here. Undefined only while
   * the parent's site fetch hasn't resolved yet, which in practice never
   * happens: SiteEditor doesn't render this panel until `site` is loaded.
   */
  publicUrl?: string;
  onClose: () => void;
  /** KAN-1267: closes this panel and opens SiteEditor's BillingPanel — wired to the actionable button the `plan_required` gate error renders below. */
  onOpenBilling: () => void;
}) {
  const [domains, setDomains] = useState<DomainWithInstruction[] | null>(null);
  const [hostname, setHostname] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addError, setAddError] = useState<AddDomainError | null>(null);
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
    setAddError(null);
    try {
      await api.addDomain(siteId, hostname);
      setHostname("");
      await refresh();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "plan_required") {
        setAddError({ kind: "plan_required", message: err.message });
      } else {
        setAddError({ kind: "other", message: err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : String(err) });
      }
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
    <SideSheet title="Domains" ariaLabel="Custom domains" closeLabel="Close domains panel" onClose={onClose} width={440}>
      {error ? <p className="pf-error-text">{error}</p> : null}
      {/* KAN-1253: the free <slug>.<platformHost> address every site already
          gets at first publish — unauthenticated, host-header-routed (see
          apps/api/src/app.ts's "Host-based public routing"). In a bare
          `make dev` stack this host won't resolve for a real browser (no
          wildcard DNS/hosts entry, see README's Local setup) — a local
          visitor needs to spoof the Host header the way e2e/tests/helpers.ts's
          gotoLiveSite does, or add a hosts entry by hand. That's a dev-only
          gap in this link's *resolvability*, not in its correctness. */}
      {publicUrl ? (
        <Card variant="filled" style={{ display: "grid", gap: "0.35rem" }}>
          <strong>Your site's free address</strong>
          <p className="pf-supporting-text" style={{ margin: 0, wordBreak: "break-all" }}>
            <a href={publicUrl} target="_blank" rel="noreferrer">
              {publicUrl}
            </a>
          </p>
          <p className="pf-supporting-text" style={{ margin: 0 }}>
            This works for anyone, no login required — share it, or add a custom domain below.
          </p>
        </Card>
      ) : null}

      {domains === null ? (
        <p className="pf-supporting-text">Loading…</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
          {domains.map(({ domain, dnsInstruction }) => (
            <li key={domain.id}>
              <Card style={{ display: "grid", gap: "0.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <strong style={{ flex: 1, wordBreak: "break-all" }}>{domain.hostname}</strong>
                  <StatusBadge tone={STATUS_TONE[domain.status]}>{STATUS_LABEL[domain.status]}</StatusBadge>
                </div>

                {domain.status !== "active" ? (
                  <Card variant="filled" style={{ padding: "0.6rem" }}>
                    <p className="pf-supporting-text" style={{ margin: "0 0 0.25rem 0", color: "var(--md-sys-color-on-surface)" }}>
                      Add a <strong>{dnsInstruction.recordType}</strong> record: name <code>{dnsInstruction.name}</code>, value{" "}
                      <code>{dnsInstruction.value}</code>.
                    </p>
                    <p className="pf-supporting-text" style={{ margin: 0 }}>
                      {dnsInstruction.note}
                    </p>
                  </Card>
                ) : null}

                {domain.verificationError ? <p className="pf-error-text">{domain.verificationError}</p> : null}

                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {domain.status !== "active" ? (
                    <OutlinedButton onClick={() => checkNow(domain.id)} disabled={busyDomainId === domain.id}>
                      {busyDomainId === domain.id ? "Checking…" : "Check now"}
                    </OutlinedButton>
                  ) : null}
                  <TextButton className="pf-destructive-button" onClick={() => remove(domain.id)} disabled={busyDomainId === domain.id}>
                    Remove
                  </TextButton>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submitAdd} style={{ display: "grid", gap: "0.5rem" }}>
        <h3 className="pf-subsection-title">Add a domain</h3>
        <TextField label="Domain" placeholder="www.yourbusiness.com" value={hostname} onChange={setHostname} />
        <FilledButton type="submit" disabled={adding || hostname.trim() === ""}>
          {adding ? "Adding…" : "Add domain"}
        </FilledButton>
        {addError?.kind === "plan_required" ? (
          <Card variant="filled" style={{ padding: "0.6rem", display: "grid", gap: "0.4rem" }}>
            <p className="pf-error-text" style={{ margin: 0 }}>
              {addError.message}
            </p>
            <FilledButton onClick={onOpenBilling} style={{ justifySelf: "start" }}>
              Upgrade to Pro
            </FilledButton>
          </Card>
        ) : addError ? (
          <p className="pf-error-text">{addError.message}</p>
        ) : null}
      </form>

      <details className="pf-supporting-text">
        <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--md-sys-color-on-surface)" }}>
          How do I add a DNS record?
        </summary>
        <ol style={{ paddingLeft: "1.1rem", display: "grid", gap: "0.3rem", margin: "0.5rem 0 0 0" }}>
          <li>Log in to whoever you bought your domain from (e.g. GoDaddy, Namecheap, Google Domains, Cloudflare).</li>
          <li>Find the "DNS" or "DNS management" section for your domain.</li>
          <li>Add a new record using the type, name and value shown above for your domain.</li>
          <li>Save — DNS changes can take a few minutes to an hour to take effect. This page checks automatically.</li>
        </ol>
      </details>
    </SideSheet>
  );
}
