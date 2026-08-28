import { useEffect, useState } from "react";
import type { SiteSummary } from "@prefab/api-client";
import { TemplateGallery } from "./TemplateGallery.js";
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
