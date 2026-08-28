import type { Fields } from "@puckeditor/core";
import type { ButtonProps } from "@prefab/blocks";

export const buttonFields: Fields<ButtonProps> = {
  label: { type: "text", label: "Label" },
  href: { type: "text", label: "Link" },
  variant: {
    type: "select",
    label: "Style",
    options: [
      { label: "Primary", value: "primary" },
      { label: "Secondary", value: "secondary" },
      { label: "Ghost", value: "ghost" },
    ],
  },
  align: {
    type: "select",
    label: "Align",
    options: [
      { label: "Left", value: "left" },
      { label: "Center", value: "center" },
      { label: "Right", value: "right" },
    ],
  },
};
