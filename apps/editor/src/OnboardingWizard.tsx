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
import { Card, FilledButton, TextButton, TextField } from "./ui/index.js";

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
    <div style={{ display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 className="pf-section-title" style={{ margin: 0 }}>
          {step === "businessType" ? businessTypeQuestion.prompt : step === "style" ? styleQuestion.prompt : "Confirm your site"}
        </h2>
        <TextButton type="button" onClick={onCancel}>
          Cancel
        </TextButton>
      </div>

      {step === "businessType" ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {businessTypeQuestion.options.map((option) => (
            <li key={option.id}>
              <Card interactive onClick={() => chooseBusinessType(option.id)}>
                <strong>{option.label}</strong>
                <div className="pf-supporting-text">{option.description}</div>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}

      {step === "style" ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {styleQuestion.options.map((option) => (
            <li key={option.id}>
              <Card interactive onClick={() => chooseStyle(option.id)}>
                <strong>{option.label}</strong>
                <div className="pf-supporting-text">{option.description}</div>
              </Card>
            </li>
          ))}
          <li>
            <TextButton type="button" onClick={() => setStep("businessType")}>
              ← Back
            </TextButton>
          </li>
        </ul>
      ) : null}

      {step === "details" && answers.businessType && answers.style ? (
        <form onSubmit={submit} style={{ display: "grid", gap: "0.75rem" }}>
          <p className="pf-supporting-text" style={{ margin: 0 }}>
            Recommended: <strong>{TEMPLATE_MANIFESTS.find((t) => t.id === answers.businessType)!.name}</strong> in the{" "}
            <strong>{getStylePreset(answers.style)!.name}</strong> style.
          </p>
          <TextField label="Slug" value={slug} onChange={setSlug} />
          <TextField label="Name" value={name} onChange={setName} />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <FilledButton type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create my site"}
            </FilledButton>
            <TextButton type="button" onClick={() => setStep("style")}>
              ← Back
            </TextButton>
          </div>
          {error ? <p className="pf-error-text">{error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
