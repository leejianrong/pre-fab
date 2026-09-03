import { useEffect, useState } from "react";
import type { SiteSummary } from "@prefab/api-client";
import { TemplateGallery } from "./TemplateGallery.js";
import { OnboardingWizard } from "./OnboardingWizard.js";
import { api } from "./api.js";

export function SitePicker({
  onSiteSelected,
}: {
  onSiteSelected: (siteId: string, opts?: { firstRun?: boolean }) => void;
}) {
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opt-in, additive entry point (KAN-1130) — the existing template gallery
  // and blank-site form below are untouched, so nothing that already
  // depends on them (e2e included) changes when the wizard isn't open.
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    api.listSites().then(setSites).catch((err) => setError(String(err)));
  }, []);

  async function createSite(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api.createSite({ slug, name });
      onSiteSelected(result.site.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  if (wizardOpen) {
    return (
      <div style={{ maxWidth: 480, margin: "4rem auto" }}>
        <OnboardingWizard onSiteCreated={onSiteSelected} onCancel={() => setWizardOpen(false)} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "4rem auto", fontFamily: "system-ui, sans-serif", display: "grid", gap: "1.5rem" }}>
      <div>
        <h2 style={{ fontSize: "1rem" }}>Your sites</h2>
        {sites === null ? (
          <p>Loading…</p>
        ) : sites.length === 0 ? (
          <p style={{ color: "#64748b" }}>No sites yet — create one below.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
            {sites.map((site) => (
              <li key={site.id}>
                <button
                  onClick={() => onSiteSelected(site.id)}
                  style={{ padding: "0.5rem 1rem", width: "100%", textAlign: "left", border: "1px solid #cbd5e1", borderRadius: "0.375rem", background: "white" }}
                >
                  {site.name} <span style={{ color: "#94a3b8" }}>({site.slug})</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={() => setWizardOpen(true)}
        style={{ padding: "0.75rem 1rem", textAlign: "left", border: "1px dashed #4f46e5", borderRadius: "0.375rem", background: "#eef2ff", color: "#4f46e5" }}
      >
        <strong>Not sure where to start?</strong>
        <div style={{ fontSize: "0.875rem" }}>Answer a couple of questions and we'll pick a template and style for you.</div>
      </button>
      <TemplateGallery onSiteCreated={(siteId) => onSiteSelected(siteId, { firstRun: true })} />
      <form onSubmit={createSite} style={{ display: "grid", gap: "0.5rem" }}>
        <h2 style={{ fontSize: "1rem" }}>Or start blank</h2>
        <input placeholder="slug" value={slug} onChange={(e) => setSlug(e.target.value)} style={{ padding: "0.5rem" }} />
        <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} style={{ padding: "0.5rem" }} />
        <button type="submit" disabled={pending} style={{ padding: "0.5rem", background: "#4f46e5", color: "white", border: "none", borderRadius: "0.375rem" }}>
          {pending ? "Creating…" : "Create site"}
        </button>
        {error ? <p style={{ color: "#dc2626", fontSize: "0.875rem" }}>{error}</p> : null}
      </form>
    </div>
  );
}
