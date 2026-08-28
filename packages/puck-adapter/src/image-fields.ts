import type { Fields } from "@puckeditor/core";
import type { ImageProps } from "@prefab/blocks";

export const imageFields: Fields<ImageProps> = {
  src: { type: "text", label: "Image URL" },
  alt: { type: "text", label: "Alt text" },
  caption: { type: "text", label: "Caption" },
  radius: {
    type: "select",
    label: "Corner radius",
    options: [
      { label: "Control", value: "control" },
      { label: "Card", value: "card" },
      { label: "Full", value: "full" },
      { label: "None", value: "none" },
    ],
  },
};
