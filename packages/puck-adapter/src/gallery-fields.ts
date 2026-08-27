import type { Fields } from "@puckeditor/core";
import type { GalleryProps } from "@prefab/blocks";

export const galleryFields: Fields<GalleryProps> = {
  images: {
    type: "array",
    label: "Images",
    max: 12,
    defaultItemProps: { src: "https://placehold.co/600x600", alt: "" },
    getItemSummary: (item, index) => item.alt || `Image ${(index ?? 0) + 1}`,
    arrayFields: {
      src: { type: "text", label: "Image URL" },
      alt: { type: "text", label: "Alt text" },
    },
  },
  columns: { type: "number", label: "Columns", min: 1, max: 4 },
};
