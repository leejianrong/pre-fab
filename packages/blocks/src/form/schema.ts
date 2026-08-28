import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

export const FORM_FIELD_TYPES = ["text", "email", "textarea", "select", "checkbox", "file"] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FormFieldSchema = z
  .object({
    type: z.enum(FORM_FIELD_TYPES),
    label: z.string().min(1).max(200),
    // A field's own stable identity — the submission record's key,
    // exactly like a native `<input name>`. No separate ULID: unlike a
    // block, a field is addressed by this name everywhere (validation,
    // the submission record, CSV export headers), so the name already is
    // the one stable reference.
    name: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, "must start with a letter and contain only letters, numbers, - or _"),
    required: z.boolean().default(false),
    /**
     * Only meaningful for `type: "select"` — one option per line, rather
     * than its own array field: Puck's array field operates on arrays of
     * objects, not of primitive strings, so a plain multiline text entry
     * is both what an owner actually wants ("one option per line") and
     * the only shape Puck's field builder can render here. Form.tsx
     * parses it the same way in the canvas and on the published page —
     * one component, one parsing rule, never duplicated.
     */
    options: z.string().max(2000).default(""),
  })
  .strict();

export type FormField = z.infer<typeof FormFieldSchema>;

export const FormPropsSchema = z
  .object({
    heading: z.string().max(120).default("Contact us"),
    fields: z
      .array(FormFieldSchema)
      .max(20)
      .default([
        { type: "text", label: "Name", name: "name", required: true, options: "" },
        { type: "email", label: "Email", name: "email", required: true, options: "" },
        { type: "textarea", label: "Message", name: "message", required: true, options: "" },
      ]),
    submitLabel: z.string().min(1).max(60).default("Submit"),
    successMessage: z.string().max(300).default("Thanks — we'll be in touch."),
    // Snapshotted into @prefab/db's `forms` table at publish time; the
    // runtime submit endpoint reads it from there, never from this prop
    // directly (R20 / ADR-0010 — the runtime never reads page documents).
    turnstileEnabled: z.boolean().default(false),
  })
  .strict();

export type FormProps = z.infer<typeof FormPropsSchema>;

export const FORM_BLOCK_TYPE = "form";
export const FORM_BLOCK_VERSION = 1;

export const formDefaultProps: FormProps = FormPropsSchema.parse({});

export const formBlockDefinition: BlockTypeDefinition<FormProps> = {
  type: FORM_BLOCK_TYPE,
  version: FORM_BLOCK_VERSION,
  propsSchema: FormPropsSchema,
  defaultProps: formDefaultProps,
  migrations: {},
};
