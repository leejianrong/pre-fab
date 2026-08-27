import ts from "typescript";
import type { ScannedFile } from "./scan.js";

export interface SsrSafetyViolation {
  file: string;
  line: number;
  identifier: string;
}

const BROWSER_GLOBALS = new Set(["window", "document", "navigator", "localStorage", "sessionStorage"]);
const EFFECT_HOOK_NAMES = new Set(["useEffect", "useLayoutEffect"]);

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) return expression.name.text;
  return undefined;
}

function scanFile(file: ScannedFile): SsrSafetyViolation[] {
  const violations: SsrSafetyViolation[] = [];
  const sourceFile = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true);

  function visit(node: ts.Node, insideEffect: boolean) {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      const firstArg = node.arguments[0];
      const isEffectCall =
        name && EFFECT_HOOK_NAMES.has(name) && firstArg && (ts.isFunctionExpression(firstArg) || ts.isArrowFunction(firstArg));
      if (isEffectCall) {
        ts.forEachChild(node, (child) => visit(child, true));
        return;
      }
    }

    if (ts.isIdentifier(node) && BROWSER_GLOBALS.has(node.text) && !insideEffect) {
      // Exclude the identifier appearing as a property name (e.g. `foo.window`) or an import specifier.
      const parent = node.parent;
      const isPropertyName = ts.isPropertyAccessExpression(parent) && parent.name === node;
      const isImportBinding = ts.isImportSpecifier(parent) || ts.isImportClause(parent);
      if (!isPropertyName && !isImportBinding) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push({ file: file.path, line: line + 1, identifier: node.text });
      }
    }

    ts.forEachChild(node, (child) => visit(child, insideEffect));
  }

  visit(sourceFile, false);
  return violations;
}

/**
 * A block component may reference a browser-only global (window, document,
 * navigator, localStorage) only inside a useEffect/useLayoutEffect
 * callback — anywhere else runs during SSR (ADR-0004's "SSR-safe" half of
 * the containment story) where those globals do not exist. AST-walked
 * rather than text-matched so a comment or a string literal mentioning
 * "window" is never a false positive.
 */
export function checkSsrSafety(files: ScannedFile[], targetPackages: string[]): SsrSafetyViolation[] {
  const violations: SsrSafetyViolation[] = [];
  for (const file of files) {
    if (!targetPackages.some((pkg) => file.path === pkg || file.path.startsWith(`${pkg}/`))) continue;
    if (file.path.includes("/test/")) continue;
    violations.push(...scanFile(file));
  }
  return violations;
}
