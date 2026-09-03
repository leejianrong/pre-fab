import { useState } from "react";
import type { ThemeTokens } from "@prefab/api-client";
import { FilledButton, SideSheet, TextField } from "./ui/index.js";

const GROUP_LABELS: Record<keyof ThemeTokens, string> = {
  color: "Colors",
  fontSize: "Font sizes",
  spacing: "Spacing",
  radius: "Radii",
};

const GROUPS = Object.keys(GROUP_LABELS) as (keyof ThemeTokens)[];

function cloneTokens(tokens: ThemeTokens): ThemeTokens {
  return {
    color: { ...tokens.color },
    fontSize: { ...tokens.fontSize },
    spacing: { ...tokens.spacing },
    radius: { ...tokens.radius },
  };
}

/**
 * Slice 2's theme editor UI — no new mutation behind it, deliberately:
 * `theme.update` already exists (Slice 1, apps/api/src/app.ts), so this is
 * a UI over an API surface that was already complete. Editing here never
 * touches a page document at all (SLICES.md: "Switching theme restyles
 * every block with no document mutation") — SiteEditor.tsx's Puck `config`
 * is recomputed from the *theme*, not from `data`, so saving new tokens
 * re-renders every existing block through the same document, unchanged.
 *
 * These are the SITE's own theme tokens (ADR-0002) — a different color
 * system entirely from the editor chrome's own MD3 tokens this panel is
 * rendered with. The two are deliberately unrelated.
 */
export function ThemeEditor({
  tokens,
  onSave,
  onClose,
}: {
  tokens: ThemeTokens;
  onSave: (tokens: ThemeTokens) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ThemeTokens>(() => cloneTokens(tokens));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(group: keyof ThemeTokens, name: string, value: string) {
    setDraft((prev) => ({ ...prev, [group]: { ...prev[group], [name]: value } }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SideSheet title="Theme" ariaLabel="Theme editor" closeLabel="Close theme editor" onClose={onClose} width={360}>
      {GROUPS.map((group) => (
        <fieldset key={group} style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
          <legend className="pf-subsection-title" style={{ padding: 0, marginBottom: "0.25rem" }}>
            {GROUP_LABELS[group]}
          </legend>
          {Object.entries(draft[group]).map(([name, value]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <TextField
                label={name}
                value={value}
                onChange={(v) => setField(group, name, v)}
                className={group === "color" ? "pf-mono-field" : undefined}
                style={{ flex: 1 }}
              />
              {group === "color" ? (
                <span
                  aria-hidden="true"
                  style={{
                    width: "1.5rem",
                    height: "1.5rem",
                    borderRadius: "var(--md-sys-shape-corner-extra-small)",
                    border: "1px solid var(--md-sys-color-outline-variant)",
                    background: value,
                    flexShrink: 0,
                  }}
                />
              ) : null}
            </div>
          ))}
        </fieldset>
      ))}

      {error ? <p className="pf-error-text">{error}</p> : null}

      <FilledButton onClick={handleSave} disabled={saving} style={{ width: "100%" }}>
        {saving ? "Saving…" : "Save theme"}
      </FilledButton>
    </SideSheet>
  );
}
