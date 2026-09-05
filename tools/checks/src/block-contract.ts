import ts from "typescript";
import type { ScannedFile } from "./scan.js";

export interface RawColorViolation {
  file: string;
  line: number;
  value: string;
}

// Exactly a 3/4/6/8-digit hex color, anchored at both ends by a non-hex
// boundary — not a prefix match, so "#cafe1234extra" doesn't trigger on its
// first 8 characters. Rare, known false-positive class: a same-page anchor
// fragment whose word happens to be entirely hex digits (`#cafe`, `#dead`,
// `#face`) reads as a 4-digit hex+alpha color to this pattern. Zero such
// anchors exist in packages/blocks/src today (block components render
// whatever `href` string a page supplies — they don't hardcode fragments
// themselves), and a human fixing a real false positive here is a one-line,
// obvious fix, unlike the cost of a raw color slipping through silently.
const HEX_COLOR = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z])/;
const COLOR_FUNCTION = /\b(?:rgb|rgba|hsl|hsla)\s*\(/i;
// A cssVar() call already produces `var(--pf-color-...)` — a literal that
// happens to contain that substring (composing cssVar() output into a
// larger string, e.g. Hero.tsx's linear-gradient over an image scrim) is
// token-driven even though the string as a whole isn't just `cssVar(...)`.
const CONTAINS_TOKEN_VAR = /var\(--pf-/;

function scanFile(file: ScannedFile): RawColorViolation[] {
  const violations: RawColorViolation[] = [];
  const sourceFile = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true);

  function checkLiteral(text: string, node: ts.Node) {
    if (CONTAINS_TOKEN_VAR.test(text)) return;
    const hexMatch = HEX_COLOR.exec(text);
    const colorFnMatch = COLOR_FUNCTION.exec(text);
    const match = hexMatch ?? colorFnMatch;
    if (!match) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push({ file: file.path, line: line + 1, value: match[0] });
  }

  function visit(node: ts.Node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      checkLiteral(node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      checkLiteral(node.head.text, node);
      for (const span of node.templateSpans) checkLiteral(span.literal.text, span.literal);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

/**
 * CLAUDE.md invariant 2 / ADR-0002: a block references a theme token
 * (`cssVar(group, name)`), never a raw color — this is the mechanical half
 * of that rule (see docs/BLOCK_CONTRACT.md), the same way checkSsrSafety is
 * the mechanical half of "SSR-safe". Deliberately narrower than "no raw
 * value of any kind": structural CSS constants that aren't a themeable
 * design decision (a `1px` border, `em`-relative padding ratios, an opacity
 * value) are not flagged — see BLOCK_CONTRACT.md's own note on why those
 * are a different kind of literal than a color.
 */
export function checkNoRawColorsInBlocks(files: ScannedFile[], blockPackages: string[] = ["packages/blocks"]): RawColorViolation[] {
  const violations: RawColorViolation[] = [];
  for (const file of files) {
    if (!blockPackages.some((pkg) => file.path === pkg || file.path.startsWith(`${pkg}/`))) continue;
    if (file.path.includes("/test/")) continue;
    if (!file.path.endsWith(".tsx")) continue;
    violations.push(...scanFile(file));
  }
  return violations;
}
