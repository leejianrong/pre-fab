import type { Fields } from "@puckeditor/core";

/**
 * Mirrors `FooterProps` (packages/blocks/src/footer/schema.ts) structurally
 * rather than importing it: @prefab/blocks's index.ts barrel is wired
 * centrally (see packages/blocks/src/index.ts) and this block isn't listed
 * there yet, so the named export isn't reachable through the package's
 * public surface. Field-shape typing only needs structural equivalence.
 */
type FooterFieldsProps = {
  text: string;
  links: { label: string; href: string }[];
};

export const footerFields: Fields<FooterFieldsProps> = {
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
