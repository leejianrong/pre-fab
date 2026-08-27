import type { Fields } from "@puckeditor/core";

/**
 * Mirrors `RichTextProps` (packages/blocks/src/richtext/schema.ts)
 * structurally rather than importing it: @prefab/blocks's index.ts barrel
 * is wired centrally (see packages/blocks/src/index.ts) and this block
 * isn't listed there yet, so the named export isn't reachable through the
 * package's public surface. Field-shape typing only needs structural
 * equivalence.
 */
type RichTextFieldsProps = {
  html: string;
  size: "body" | "lg";
  align: "left" | "center";
};

export const richTextFields: Fields<RichTextFieldsProps> = {
  html: { type: "textarea", label: "Text (blank line = new paragraph)" },
  size: {
    type: "select",
    label: "Size",
    options: [
      { label: "Body", value: "body" },
      { label: "Large", value: "lg" },
    ],
  },
  align: {
    type: "select",
    label: "Align",
    options: [
      { label: "Left", value: "left" },
      { label: "Center", value: "center" },
    ],
  },
};
