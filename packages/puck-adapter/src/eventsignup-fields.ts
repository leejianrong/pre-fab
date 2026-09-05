import type { Fields } from "@puckeditor/core";
import type { EventSignupProps } from "@prefab/blocks";

/**
 * The field builder (KAN-1138) — identical shape to form-fields.ts's own
 * `fields` array field, plus capacity/waitlist controls. `options` is a
 * newline-separated textarea, not its own array field, for the exact reason
 * form-fields.ts documents (Puck's ArrayField only operates on arrays of
 * objects).
 */
export const eventSignupFields: Fields<EventSignupProps> = {
  heading: { type: "text", label: "Heading" },
  description: { type: "textarea", label: "Event details (date, time, location) — plain text" },
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
      name: { type: "text", label: "Field name (used as the sign-up record's key)" },
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
  capacity: { type: "number", label: "Capacity (blank = unlimited)" },
  waitlistEnabled: {
    type: "radio",
    label: "Waitlist once full",
    options: [
      { label: "On", value: true },
      { label: "Off", value: false },
    ],
  },
  submitLabel: { type: "text", label: "Submit button label" },
  successMessage: { type: "textarea", label: "Message shown once confirmed" },
  waitlistMessage: { type: "textarea", label: "Message shown once waitlisted" },
  fullMessage: { type: "textarea", label: "Message shown when full (waitlist off)" },
};
