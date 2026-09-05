import { useEffect, useState } from "react";
import type { TemplateSummary } from "@prefab/api-client";
import { api } from "./api.js";
import { Card, FilledButton, OutlinedButton, TextButton, TextField } from "./ui/index.js";

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
      <form onSubmit={submitFork} style={{ display: "grid", gap: "0.75rem" }}>
        <h2 className="pf-section-title">Use "{forking.name}"</h2>
        <TextField label="Site slug" value={slug} onChange={setSlug} />
        <TextField label="Site name" value={name} onChange={setName} />
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <FilledButton type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create my site"}
          </FilledButton>
          <TextButton type="button" onClick={() => setForking(null)}>
            Back
          </TextButton>
        </div>
        {error ? <p className="pf-error-text">{error}</p> : null}
      </form>
    );
  }

  return (
    <div>
      <h2 className="pf-section-title">Start from a template</h2>
      {templates === null ? (
        <p className="pf-supporting-text">Loading templates…</p>
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
            <li key={template.id}>
              <Card style={{ display: "grid", gap: "0.4rem" }}>
                <strong>{template.name}</strong>
                <span className="pf-supporting-text">{template.tagline}</span>
                <OutlinedButton onClick={() => startFork(template)}>Use this template</OutlinedButton>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="pf-error-text">{error}</p> : null}
    </div>
  );
}
