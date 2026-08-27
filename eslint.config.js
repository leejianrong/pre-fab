// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.astro/**",
      "**/.astro-workspace/**",
      "**/.data/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // React hooks rules where JSX lives.
  {
    files: ["apps/editor/**/*.{ts,tsx}", "packages/blocks/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // ADR-0004 / CLAUDE.md invariant 3: block components never import Puck
  // context. The authoritative check is tools/checks (AST-based, CI-gated);
  // this is the fast-feedback mirror during editing.
  {
    files: ["packages/blocks/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@puckeditor/*", "astro", "astro/*", "@astrojs/*"],
              message:
                "packages/blocks must stay SSR-safe and Puck-free (ADR-0004, ADR-0007). See tools/checks.",
            },
          ],
        },
      ],
    },
  },
  // ADR-0007 / CLAUDE.md invariant 3: nothing outside the publish pipeline
  // imports Astro.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["packages/publish/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["astro", "astro/*", "@astrojs/*"],
              message:
                "Only packages/publish may import Astro (ADR-0007). See tools/checks.",
            },
          ],
        },
      ],
    },
  },
);
