import type { FieldValidationIssue, FormFieldDef, SubmissionValues, ValidationResult } from "./types.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT_LENGTH = 2000;
const MAX_TEXTAREA_LENGTH = 20_000;

/** Mirrors @prefab/blocks' Form.tsx `parseOptions` exactly — one parsing rule for the same newline-separated string, wherever it's read. */
function parseOptions(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * A raw submission is an untyped bag of strings (form-encoded values, or a
 * JSON body from a non-browser client) — this is the one place that turns
 * it into something checked against a form's field definitions. Unknown
 * keys are dropped rather than stored: nothing beyond what the form
 * actually asked for should ever land in a submission record.
 */
export function validateSubmissionValues(fields: FormFieldDef[], raw: Record<string, unknown>): ValidationResult {
  const issues: FieldValidationIssue[] = [];
  const values: SubmissionValues = {};

  for (const field of fields) {
    const rawValue = raw[field.name];

    if (field.type === "checkbox") {
      values[field.name] = rawValue === true || rawValue === "true" || rawValue === "on";
      continue;
    }

    const stringValue = typeof rawValue === "string" ? rawValue.trim() : "";

    if (field.required && stringValue === "") {
      issues.push({ field: field.name, message: `${field.label} is required` });
      continue;
    }

    if (stringValue === "") {
      values[field.name] = "";
      continue;
    }

    switch (field.type) {
      case "email":
        if (!EMAIL_PATTERN.test(stringValue)) {
          issues.push({ field: field.name, message: `${field.label} must be a valid email address` });
          continue;
        }
        break;
      case "select": {
        const options = parseOptions(field.options ?? "");
        if (options.length > 0 && !options.includes(stringValue)) {
          issues.push({ field: field.name, message: `${field.label} must be one of the offered options` });
          continue;
        }
        break;
      }
      case "textarea":
        if (stringValue.length > MAX_TEXTAREA_LENGTH) {
          issues.push({ field: field.name, message: `${field.label} is too long` });
          continue;
        }
        break;
      case "text":
      case "file":
        if (stringValue.length > MAX_TEXT_LENGTH) {
          issues.push({ field: field.name, message: `${field.label} is too long` });
          continue;
        }
        break;
    }

    values[field.name] = stringValue;
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, values };
}
