import { describe, expect, it } from "vitest";
import { checkPerformanceScore, classifyBlockingAxeViolations, type AxeViolation } from "../src/budgets.js";

describe("checkPerformanceScore (R3)", () => {
  it("passes at or above 90", () => {
    expect(checkPerformanceScore(90)).toBeNull();
    expect(checkPerformanceScore(100)).toBeNull();
  });

  it("fails below 90, naming the score", () => {
    expect(checkPerformanceScore(89)).toContain("89");
    expect(checkPerformanceScore(0)).not.toBeNull();
  });
});

describe("classifyBlockingAxeViolations (R6)", () => {
  it("blocks any critical violation, whatever the rule", () => {
    const violations: AxeViolation[] = [{ id: "some-rule", impact: "critical", nodes: 1 }];
    expect(classifyBlockingAxeViolations(violations)).toHaveLength(1);
  });

  it("blocks color-contrast even at a non-critical impact — WCAG 2.2 AA is a separate template-level clause", () => {
    const violations: AxeViolation[] = [{ id: "color-contrast", impact: "serious", nodes: 1 }];
    expect(classifyBlockingAxeViolations(violations)).toHaveLength(1);
  });

  it("does not block a non-contrast, non-critical violation", () => {
    const violations: AxeViolation[] = [
      { id: "region", impact: "moderate", nodes: 1 },
      { id: "landmark-one-main", impact: "moderate", nodes: 1 },
    ];
    expect(classifyBlockingAxeViolations(violations)).toHaveLength(0);
  });
});
