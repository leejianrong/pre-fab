import { useEffect, useState } from "react";
import type { TemplateSummary } from "@prefab/api-client";
import { api } from "./api.js";

/**
 * Fork-on-use (ADR-0011): picking a template calls site.createFromTemplate,
 * which mints a brand-new site with every page and block re-keyed to a
 * fresh id server-side (packages/schema's rekeyPageForFork) — this
 * component never sees or copies a block id itself.
 */
export function TemplateGallery({ onSiteCreated }: { onSiteCreated: (siteId: string) => void }) {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forking, setForking] = useState<TemplateSummary | null>(null);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api.listTemplates().then(setTemplates).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  function startFork(template: TemplateSummary) {
    setForking(template);
    setName(template.name);
    setSlug(template.id);
    setError(null);
  }

  async function submitFork(event: React.FormEvent) {
    event.preventDefault();
    if (!forking) return;
    setPending(true);
    setError(null);
    try {
      const result = await api.createSiteFromTemplate(forking.id, { slug, name });
      onSiteCreated(result.site.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  if (forking) {
    return (
      <form onSubmit={submitFork} style={{ display: "grid", gap: "0.5rem" }}>
        <h2 style={{ fontSize: "1rem", margin: 0 }}>Use "{forking.name}"</h2>
        <input
          placeholder="slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          style={{ padding: "0.5rem" }}
          aria-label="Site slug"
        />
        <input
          placeholder="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: "0.5rem" }}
          aria-label="Site name"
        />
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="submit"
            disabled={pending}
            style={{ padding: "0.5rem 1rem", background: "#4f46e5", color: "white", border: "none", borderRadius: "0.375rem" }}
          >
            {pending ? "Creating…" : "Create my site"}
          </button>
          <button type="button" onClick={() => setForking(null)} style={{ padding: "0.5rem 1rem" }}>
            Back
          </button>
        </div>
        {error ? <p style={{ color: "#dc2626", fontSize: "0.875rem" }}>{error}</p> : null}
      </form>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: "1rem" }}>Start from a template</h2>
      {templates === null ? (
        <p>Loading templates…</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "0.75rem",
          }}
        >
          {templates.map((template) => (
            <li
              key={template.id}
              style={{ border: "1px solid #e2e8f0", borderRadius: "0.5rem", padding: "1rem", display: "grid", gap: "0.4rem" }}
            >
              <strong>{template.name}</strong>
              <span style={{ fontSize: "0.8125rem", color: "#64748b" }}>{template.tagline}</span>
              <button
                onClick={() => startFork(template)}
                style={{ padding: "0.4rem 0.8rem", border: "1px solid #4f46e5", color: "#4f46e5", background: "white", borderRadius: "0.375rem", cursor: "pointer" }}
              >
                Use this template
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p style={{ color: "#dc2626", fontSize: "0.875rem" }}>{error}</p> : null}
    </div>
  );
}
