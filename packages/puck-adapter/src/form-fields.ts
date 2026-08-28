import type { Fields } from "@puckeditor/core";
import type { FormProps } from "@prefab/blocks";

/**
 * The field builder (SLICES.md Slice 6): text/email/textarea/select/
 * checkbox/file, same `type: "array"` shape faq-fields.ts already
 * established. `options` is a newline-separated textarea, not its own
 * array field — Puck's `ArrayField` only operates on arrays of objects
 * (`arrayFields` is keyed by each item's own props), never arrays of
 * primitive strings, so a plain multiline text entry is the only shape
 * available here; it also happens to be what "one option per line" wants
 * anyway. Form.tsx parses it, identically in the canvas and on the
 * published page.
 */
export const formFields: Fields<FormProps> = {
  heading: { type: "text", label: "Heading" },
  fields: {
    type: "array",
    label: "Fields",
    max: 20,
    getItemSummary: (item) => item.label || "Field",
    arrayFields: {
      type: {
        type: "select",
        label: "Type",
        options: [
          { label: "Text", value: "text" },
          { label: "Email", value: "email" },
          { label: "Textarea", value: "textarea" },
          { label: "Select", value: "select" },
          { label: "Checkbox", value: "checkbox" },
          { label: "File", value: "file" },
        ],
      },
      label: { type: "text", label: "Label" },
      name: { type: "text", label: "Field name (used as the submission key)" },
      required: {
        type: "radio",
        label: "Required",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
      },
      options: { type: "textarea", label: "Options — one per line (Select only)" },
    },
    defaultItemProps: { type: "text", label: "New field", name: "field", required: false, options: "" },
  },
  submitLabel: { type: "text", label: "Submit button label" },
  successMessage: { type: "textarea", label: "Message shown after a successful submission" },
  turnstileEnabled: {
    type: "radio",
    label: "Spam protection (Cloudflare Turnstile)",
    options: [
      { label: "On", value: true },
      { label: "Off", value: false },
    ],
  },
};
