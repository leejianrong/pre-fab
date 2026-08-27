import type { Fields } from "@puckeditor/core";
import type { MapEmbedProps } from "@prefab/blocks/mapembed";

export const mapembedFields: Fields<MapEmbedProps> = {
  query: { type: "text", label: "Location (place name or address)" },
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
