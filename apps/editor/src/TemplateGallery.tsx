import { useEffect, useState } from "react";
import { ApiClientError, type TemplateSummary } from "@prefab/api-client";
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
  const [slugError, setSlugError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api.listTemplates().then(setTemplates).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  function startFork(template: TemplateSummary) {
    setForking(template);
    setName(template.name);
    // `sites.slug` is unique across the whole platform, not per-account —
    // defaulting to the bare template id meant the first account to fork
    // "Yoga & Wellness Studio" permanently claimed `wellness-studio`, and
    // every fork after that (including a second one from the same account)
    // 500'd. Suffix it the same way OnboardingWizard's fork-on-use flow
    // already does, so the pre-filled value is never a guaranteed collision.
    setSlug(`${template.id}-${Date.now()}`);
    setError(null);
    setSlugError(null);
  }

  function changeSlug(value: string) {
    setSlug(value);
    setSlugError(null);
  }

  async function submitFork(event: React.FormEvent) {
    event.preventDefault();
    if (!forking) return;
    setPending(true);
    setError(null);
    setSlugError(null);
    try {
      const result = await api.createSiteFromTemplate(forking.id, { slug, name });
      onSiteCreated(result.site.id);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "conflict") {
        setSlugError("That site slug is already taken — try a different one.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setPending(false);
    }
  }

  if (forking) {
    return (
      <form onSubmit={submitFork} style={{ display: "grid", gap: "0.75rem" }}>
        <h2 className="pf-section-title">Use "{forking.name}"</h2>
        <TextField
          label="Site slug"
          value={slug}
          onChange={changeSlug}
          error={Boolean(slugError)}
          errorText={slugError ?? undefined}
        />
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
        <ul className="pf-template-grid" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {templates.map((template) => (
            <li key={template.id}>
              {/* padding/overflow override Card's own baked-in 1rem padding
                  (ui/Card.tsx has no media-slot prop) so the thumbnail can
                  sit full-bleed at the top, flush with the card's rounded
                  corners, with the text/button below back in a padded
                  region of their own. */}
              <Card style={{ padding: 0, overflow: "hidden", display: "grid", gap: 0 }}>
                <img
                  src={`${api.baseUrl}${template.thumbnailUrl}`}
                  alt={`Preview of the "${template.name}" template`}
                  loading="lazy"
                  style={{ display: "block", width: "100%", aspectRatio: "8 / 5", objectFit: "cover" }}
                />
                <div style={{ display: "grid", gap: "0.4rem", padding: "1rem" }}>
                  <strong>{template.name}</strong>
                  <span className="pf-supporting-text">{template.tagline}</span>
                  <OutlinedButton onClick={() => startFork(template)}>Use this template</OutlinedButton>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="pf-error-text">{error}</p> : null}
    </div>
  );
}
