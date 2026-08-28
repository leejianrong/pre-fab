import type { Fields } from "@puckeditor/core";
import type { EmbedProps } from "@prefab/blocks";

export const embedFields: Fields<EmbedProps> = {
  html: { type: "textarea", label: "Embed HTML" },
  height: {
    type: "select",
    label: "Height",
    options: [
      { label: "Small", value: "sm" },
      { label: "Medium", value: "md" },
      { label: "Large", value: "lg" },
    ],
  },
};
