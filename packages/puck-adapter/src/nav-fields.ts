import type { Fields } from "@puckeditor/core";
import type { NavProps } from "@prefab/blocks";

export const navFields: Fields<NavProps> = {
  brand: { type: "text", label: "Brand / business name" },
  links: {
    type: "array",
    label: "Links",
    max: 8,
    defaultItemProps: { label: "Link", href: "#" },
    getItemSummary: (item) => item.label || "Link",
    arrayFields: {
      label: { type: "text", label: "Label" },
      href: { type: "text", label: "Link" },
    },
  },
};
