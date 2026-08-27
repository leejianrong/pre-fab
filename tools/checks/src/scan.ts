import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const EXCLUDED_DIR_NAMES = new Set(["node_modules", "dist", ".astro-workspace", ".vite", "coverage"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

export interface ScannedFile {
  /** Repo-relative, forward-slash path — stable across platforms and easy to match with a glob-ish prefix. */
  path: string;
  /** Every module specifier this file imports, requires, or re-exports from. */
  imports: string[];
  /** Full source text — kept alongside imports so every check is a pure function over in-memory fixtures, no disk access. */
  text: string;
}

function listFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue;
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...listFilesRecursive(full));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

function extractImports(sourceText: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

/** Scans every .ts/.tsx file under `roots` (repo-relative or absolute) for its import specifiers. */
export function scanRepo(repoRoot: string, roots: string[]): ScannedFile[] {
  const files: ScannedFile[] = [];
  for (const root of roots) {
    const absoluteRoot = path.isAbsolute(root) ? root : path.join(repoRoot, root);
    let filePaths: string[];
    try {
      filePaths = listFilesRecursive(absoluteRoot);
    } catch {
      continue; // package doesn't have this directory (e.g. no test/) — nothing to scan
    }
    for (const filePath of filePaths) {
      const sourceText = readFileSync(filePath, "utf8");
      const relativePath = path.relative(repoRoot, filePath).split(path.sep).join("/");
      files.push({ path: relativePath, imports: extractImports(sourceText, filePath), text: sourceText });
    }
  }
  return files;
}
