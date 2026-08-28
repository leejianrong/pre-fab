import type { Fields } from "@puckeditor/core";
import type { SpacerProps } from "@prefab/blocks";

export const spacerFields: Fields<SpacerProps> = {
  height: {
    type: "select",
    label: "Height",
    options: [
      { label: "Extra small", value: "xs" },
      { label: "Small", value: "sm" },
      { label: "Element", value: "element" },
      { label: "Large", value: "lg" },
      { label: "Section", value: "section" },
    ],
  },
};
