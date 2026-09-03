import { useState } from "react";
import {
  TEMPLATE_MANIFESTS,
  WIZARD_QUESTIONS,
  getStylePreset,
  recommend,
  stylePresetToThemeTokens,
  type WizardAnswers,
} from "@prefab/templates";
import { api } from "./api.js";

type Step = "businessType" | "style" | "details";

/**
 * KAN-1130: a deterministic branching wizard (business type -> style ->
 * confirm), not an LLM prompt-to-site flow. `recommend` (packages/templates)
 * is a pure, validated lookup — this component is just the three-step
 * presentation over it, plus the two existing mutations (fork-on-use,
 * theme.update) every other onboarding path already uses.
 */
export function OnboardingWizard({
  onSiteCreated,
  onCancel,
}: {
  onSiteCreated: (siteId: string, opts?: { firstRun?: boolean }) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>("businessType");
  const [answers, setAnswers] = useState<Partial<WizardAnswers>>({});
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function chooseBusinessType(businessType: string) {
    setAnswers((prev) => ({ ...prev, businessType }));
    setStep("style");
  }

  function chooseStyle(style: string) {
    const businessType = answers.businessType;
    if (!businessType) return;
    const recommendation = recommend({ businessType, style });
    const template = TEMPLATE_MANIFESTS.find((candidate) => candidate.id === recommendation.templateId)!;
    setAnswers((prev) => ({ ...prev, style }));
    setSlug(`${template.id}-${Date.now()}`);
    setName(template.name);
    setStep("details");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!answers.businessType || !answers.style) return;
    setPending(true);
    setError(null);
    try {
      const recommendation = recommend({ businessType: answers.businessType, style: answers.style });
      const result = await api.createSiteFromTemplate(recommendation.templateId, { slug, name });
      const preset = getStylePreset(recommendation.presetId)!;
      await api.updateTheme(result.site.id, stylePresetToThemeTokens(preset));
      onSiteCreated(result.site.id, { firstRun: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  const businessTypeQuestion = WIZARD_QUESTIONS[0]!;
  const styleQuestion = WIZARD_QUESTIONS[1]!;

  return (
    <div style={{ display: "grid", gap: "1rem", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ fontSize: "1rem", margin: 0 }}>
          {step === "businessType" ? businessTypeQuestion.prompt : step === "style" ? styleQuestion.prompt : "Confirm your site"}
        </h2>
        <button type="button" onClick={onCancel} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer" }}>
          Cancel
        </button>
      </div>

      {step === "businessType" ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {businessTypeQuestion.options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => chooseBusinessType(option.id)}
                style={{ width: "100%", textAlign: "left", padding: "0.75rem 1rem", border: "1px solid #cbd5e1", borderRadius: "0.375rem", background: "white" }}
              >
                <strong>{option.label}</strong>
                <div style={{ color: "#64748b", fontSize: "0.875rem" }}>{option.description}</div>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {step === "style" ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {styleQuestion.options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => chooseStyle(option.id)}
                style={{ width: "100%", textAlign: "left", padding: "0.75rem 1rem", border: "1px solid #cbd5e1", borderRadius: "0.375rem", background: "white" }}
              >
                <strong>{option.label}</strong>
                <div style={{ color: "#64748b", fontSize: "0.875rem" }}>{option.description}</div>
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setStep("businessType")} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: "0.25rem 0" }}>
              ← Back
            </button>
          </li>
        </ul>
      ) : null}

      {step === "details" && answers.businessType && answers.style ? (
        <form onSubmit={submit} style={{ display: "grid", gap: "0.5rem" }}>
          <p style={{ color: "#64748b", fontSize: "0.875rem", margin: 0 }}>
            Recommended: <strong>{TEMPLATE_MANIFESTS.find((t) => t.id === answers.businessType)!.name}</strong> in the{" "}
            <strong>{getStylePreset(answers.style)!.name}</strong> style.
          </p>
          <input placeholder="slug" value={slug} onChange={(e) => setSlug(e.target.value)} style={{ padding: "0.5rem" }} />
          <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} style={{ padding: "0.5rem" }} />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" disabled={pending} style={{ padding: "0.5rem 1rem", background: "#4f46e5", color: "white", border: "none", borderRadius: "0.375rem" }}>
              {pending ? "Creating…" : "Create my site"}
            </button>
            <button type="button" onClick={() => setStep("style")} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer" }}>
              ← Back
            </button>
          </div>
          {error ? <p style={{ color: "#dc2626", fontSize: "0.875rem" }}>{error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
