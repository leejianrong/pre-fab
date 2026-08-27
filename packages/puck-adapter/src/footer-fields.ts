import type { Fields } from "@puckeditor/core";
import type { FooterProps } from "@prefab/blocks";

export const footerFields: Fields<FooterProps> = {
  text: { type: "text", label: "Copyright text" },
  links: {
    type: "array",
    label: "Links",
    max: 6,
    defaultItemProps: { label: "Link", href: "#" },
    getItemSummary: (item) => item.label || "Link",
    arrayFields: {
      label: { type: "text", label: "Label" },
      href: { type: "text", label: "Link" },
    },
  },
};
