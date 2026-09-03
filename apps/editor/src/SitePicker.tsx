import { useEffect, useState } from "react";
import type { SiteSummary } from "@prefab/api-client";
import { TemplateGallery } from "./TemplateGallery.js";
import { OnboardingWizard } from "./OnboardingWizard.js";
import { api } from "./api.js";
import { Card, FilledButton, TextField } from "./ui/index.js";

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
    <div style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem", display: "grid", gap: "1.5rem" }}>
      <div>
        <h2 className="pf-section-title">Your sites</h2>
        {sites === null ? (
          <p className="pf-supporting-text">Loading…</p>
        ) : sites.length === 0 ? (
          <p className="pf-supporting-text">No sites yet — create one below.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
            {sites.map((site) => (
              <li key={site.id}>
                <Card interactive onClick={() => onSiteSelected(site.id)}>
                  {site.name} <span style={{ color: "var(--md-sys-color-on-surface-variant)" }}>({site.slug})</span>
                </Card>
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
      <form onSubmit={createSite} style={{ display: "grid", gap: "0.75rem" }}>
        <h2 className="pf-section-title">Or start blank</h2>
        <TextField label="Slug" value={slug} onChange={setSlug} />
        <TextField label="Name" value={name} onChange={setName} />
        <FilledButton type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create site"}
        </FilledButton>
        {error ? <p className="pf-error-text">{error}</p> : null}
      </form>
    </div>
  );
}
