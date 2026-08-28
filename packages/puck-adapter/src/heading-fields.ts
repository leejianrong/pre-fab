import type { Fields } from "@puckeditor/core";
import type { HeadingProps } from "@prefab/blocks";

export const headingFields: Fields<HeadingProps> = {
  text: { type: "text", label: "Text" },
  level: {
    type: "select",
    label: "Heading level",
    options: [
      { label: "H1", value: "h1" },
      { label: "H2", value: "h2" },
      { label: "H3", value: "h3" },
    ],
  },
  size: {
    type: "select",
    label: "Size",
    options: [
      { label: "Body", value: "body" },
      { label: "Large", value: "lg" },
      { label: "Heading", value: "heading" },
      { label: "Display", value: "display" },
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
