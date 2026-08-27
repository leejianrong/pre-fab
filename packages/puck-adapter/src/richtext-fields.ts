import type { Fields } from "@puckeditor/core";
import type { RichTextProps } from "@prefab/blocks";

export const richTextFields: Fields<RichTextProps> = {
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
