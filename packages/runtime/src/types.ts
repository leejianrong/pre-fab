/**
 * The runtime API's own vocabulary (ADR-0007 / ADR-0010) — deliberately
 * independent of @prefab/schema and every control-plane package. Slice 7's
 * self-host runtime reimplements the interfaces in this package against
 * SQLite instead of Postgres; it must never need to pull in the control
 * plane to do so, so nothing in here references a control-plane type even
 * by name.
 */

export const FORM_FIELD_TYPES = ["text", "email", "textarea", "select", "checkbox", "file"] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export interface FormFieldDef {
  type: FormFieldType;
  label: string;
  /** The submission record's key for this field — the field's own stable identity, the same way a native `<input name>` is. */
  name: string;
  required: boolean;
  /** Only meaningful for `type: "select"` — one option per line (matches @prefab/blocks' Form block, which is where this shape is authored). */
  options?: string;
}

/** The publish-safe manifest a form's submit request is validated against — see @prefab/db's `forms` table. */
export interface FormManifest {
  id: string;
  siteId: string;
  heading: string;
  fields: FormFieldDef[];
  submitLabel: string;
  turnstileEnabled: boolean;
}

export type SubmissionValues = Record<string, string | boolean>;

export interface FieldValidationIssue {
  field: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; values: SubmissionValues }
  | { ok: false; issues: FieldValidationIssue[] };
