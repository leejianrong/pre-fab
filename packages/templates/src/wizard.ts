import { TEMPLATE_MANIFESTS } from "./manifest.js";
import { STYLE_PRESETS, getStylePreset } from "./presets.js";

/**
 * KAN-1130: a deterministic branching questionnaire, not an LLM-driven
 * "assemble a site from a prompt" flow (Squarespace Blueprint AI-style) —
 * decided 2026-09-03 for determinism, testability and cost, and because a
 * recommendation that's just a validated lookup from an explicit question
 * bank is the ADR-0006 "explicit, versioned, debuggable over black-box"
 * philosophy applied to onboarding. Two independent questions (what the
 * site is for, what it should look like) rather than one combined
 * business-type-implies-style step: template and style preset are already
 * orthogonal (ADR-0002 separates content structure from design tokens),
 * so any template can pair with any preset, and the questionnaire mirrors
 * that rather than hiding it. AI (copy suggestions, image touch-up) can
 * layer on top of the result later — it never decides the result itself.
 */
export interface WizardOption {
  id: string;
  label: string;
  description: string;
}

export interface WizardQuestion {
  id: "businessType" | "style";
  prompt: string;
  options: WizardOption[];
}

export const BUSINESS_TYPE_QUESTION: WizardQuestion = {
  id: "businessType",
  prompt: "What are you building a site for?",
  options: TEMPLATE_MANIFESTS.map((template) => ({
    id: template.id,
    label: template.name,
    description: template.tagline,
  })),
};

export const STYLE_QUESTION: WizardQuestion = {
  id: "style",
  prompt: "Which style feels right?",
  options: STYLE_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.name,
    description: preset.description,
  })),
};

/** Presentation order — businessType first (it's the more concrete question), style second. */
export const WIZARD_QUESTIONS: WizardQuestion[] = [BUSINESS_TYPE_QUESTION, STYLE_QUESTION];

export interface WizardAnswers {
  businessType: string;
  style: string;
}

export interface WizardRecommendation {
  templateId: string;
  presetId: string;
}

/** Thrown for an answer id that isn't one of the question's own options — never silently substituted with a default (the "no-silent-magic" half of KAN-1130's decision, same reasoning as ADR-0006's rejected-write-over-silent-loss). */
export class WizardAnswerError extends Error {}

/**
 * Every option id above already *is* a template id or preset id — the
 * recommendation is a validated pass-through, not a scored heuristic.
 * Keeping it that way is deliberate: a wizard whose "AI-feeling" magic is
 * actually a hidden weighting function is exactly the kind of black box
 * this card exists to avoid. Framing two direct choices as friendly
 * questions is the whole trick.
 */
export function recommend(answers: WizardAnswers): WizardRecommendation {
  const template = TEMPLATE_MANIFESTS.find((candidate) => candidate.id === answers.businessType);
  if (!template) throw new WizardAnswerError(`unknown businessType "${answers.businessType}"`);

  const preset = getStylePreset(answers.style);
  if (!preset) throw new WizardAnswerError(`unknown style "${answers.style}"`);

  return { templateId: template.id, presetId: preset.id };
}
