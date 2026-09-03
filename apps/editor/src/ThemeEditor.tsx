import { useState } from "react";
import type { ThemeTokens } from "@prefab/api-client";

const GROUP_LABELS: Record<keyof ThemeTokens, string> = {
  color: "Colors",
  fontSize: "Font sizes",
  spacing: "Spacing",
  radius: "Radii",
  fontFamily: "Font families",
};

const GROUPS = Object.keys(GROUP_LABELS) as (keyof ThemeTokens)[];

function cloneTokens(tokens: ThemeTokens): ThemeTokens {
  return {
    color: { ...tokens.color },
    fontSize: { ...tokens.fontSize },
    spacing: { ...tokens.spacing },
    radius: { ...tokens.radius },
    fontFamily: { ...tokens.fontFamily },
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
    <div
      role="dialog"
      aria-label="Theme editor"
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
          width: "360px",
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
          <h2 style={{ fontSize: "1.125rem", margin: 0, flex: 1 }}>Theme</h2>
          <button onClick={onClose} aria-label="Close theme editor" style={{ border: "none", background: "none", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        {GROUPS.map((group) => (
          <fieldset key={group} style={{ border: "none", padding: 0, marginBottom: "1.25rem" }}>
            <legend style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.5rem" }}>{GROUP_LABELS[group]}</legend>
            {Object.entries(draft[group]).map(([name, value]) => (
              <label key={name} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                <span style={{ flex: "0 0 40%", fontSize: "0.8125rem", color: "#475569" }}>{name}</span>
                {group === "color" ? (
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => setField(group, name, e.target.value)}
                    data-pf-token-input={`${group}.${name}`}
                    style={{
                      flex: 1,
                      padding: "0.25rem 0.4rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.25rem",
                      fontFamily: "monospace",
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => setField(group, name, e.target.value)}
                    data-pf-token-input={`${group}.${name}`}
                    style={{ flex: 1, padding: "0.25rem 0.4rem", border: "1px solid #e2e8f0", borderRadius: "0.25rem" }}
                  />
                )}
                {group === "color" ? (
                  <span
                    aria-hidden="true"
                    style={{
                      width: "1.25rem",
                      height: "1.25rem",
                      borderRadius: "0.25rem",
                      border: "1px solid #e2e8f0",
                      background: value,
                      flexShrink: 0,
                    }}
                  />
                ) : null}
              </label>
            ))}
          </fieldset>
        ))}

        {error ? <p style={{ color: "#dc2626", fontSize: "0.8125rem" }}>{error}</p> : null}

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: "100%",
            padding: "0.5rem",
            background: "#4f46e5",
            color: "white",
            border: "none",
            borderRadius: "0.25rem",
            cursor: "pointer",
          }}
        >
          {saving ? "Saving…" : "Save theme"}
        </button>
      </div>
    </div>
  );
}
