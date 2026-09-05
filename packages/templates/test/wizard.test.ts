import { describe, expect, it } from "vitest";
import { ThemeTokensSchema } from "@prefab/schema";
import { TEMPLATE_MANIFESTS } from "../src/manifest.js";
import { STYLE_PRESETS, getStylePreset, stylePresetToThemeTokens } from "../src/presets.js";
import { BUSINESS_TYPE_QUESTION, STYLE_QUESTION, WIZARD_QUESTIONS, WizardAnswerError, recommend } from "../src/wizard.js";

describe("wizard questions", () => {
  it("offers one businessType option per template, in the same order", () => {
    expect(BUSINESS_TYPE_QUESTION.options.map((o) => o.id)).toEqual(TEMPLATE_MANIFESTS.map((t) => t.id));
  });

  it("offers one style option per preset, in the same order", () => {
    expect(STYLE_QUESTION.options.map((o) => o.id)).toEqual(STYLE_PRESETS.map((p) => p.id));
  });

  it("presents businessType before style", () => {
    expect(WIZARD_QUESTIONS.map((q) => q.id)).toEqual(["businessType", "style"]);
  });
});

describe("recommend", () => {
  it("is a deterministic pass-through: every (template, style) pair round-trips to itself", () => {
    for (const template of TEMPLATE_MANIFESTS) {
      for (const preset of STYLE_PRESETS) {
        const result = recommend({ businessType: template.id, style: preset.id });
        expect(result).toEqual({ templateId: template.id, presetId: preset.id });
      }
    }
  });

  it("is a pure function — same answers always produce the same recommendation", () => {
    const answers = { businessType: "cafe", style: "warm" };
    expect(recommend(answers)).toEqual(recommend(answers));
  });

  it("rejects an unknown businessType rather than silently defaulting", () => {
    expect(() => recommend({ businessType: "not-a-template", style: "warm" })).toThrow(WizardAnswerError);
  });

  it("rejects an unknown style rather than silently defaulting", () => {
    expect(() => recommend({ businessType: "cafe", style: "not-a-style" })).toThrow(WizardAnswerError);
  });
});

describe("style presets", () => {
  it("has no duplicate ids", () => {
    const ids = STYLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getStylePreset finds a preset by id and returns undefined for an unknown one", () => {
    expect(getStylePreset("modern")?.name).toBe("Clean & Modern");
    expect(getStylePreset("not-a-style")).toBeUndefined();
  });

  it("stylePresetToThemeTokens produces a complete, schema-valid ThemeTokens for every preset", () => {
    for (const preset of STYLE_PRESETS) {
      const tokens = stylePresetToThemeTokens(preset);
      expect(ThemeTokensSchema.safeParse(tokens).success).toBe(true);
      expect(tokens.color).toEqual(preset.color);
      expect(tokens.fontFamily).toEqual(preset.fontFamily);
      // fontSize/spacing/radius aren't part of a preset — they come from the platform default.
      expect(Object.keys(tokens.fontSize).length).toBeGreaterThan(0);
    }
  });
});
