import type { Fields } from "@puckeditor/core";
import type { CardGridProps } from "@prefab/blocks";

export const cardGridFields: Fields<CardGridProps> = {
  cards: {
    type: "array",
    label: "Cards",
    max: 9,
    defaultItemProps: { title: "New card", body: "", href: "" },
    getItemSummary: (item, index) => item.title || `Card ${(index ?? 0) + 1}`,
    arrayFields: {
      title: { type: "text", label: "Title" },
      body: { type: "textarea", label: "Body" },
      href: { type: "text", label: "Link" },
    },
  },
  columns: { type: "number", label: "Columns", min: 1, max: 3 },
};
