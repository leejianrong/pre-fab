import type { Fields } from "@puckeditor/core";

/**
 * Mirrors `NavProps` (packages/blocks/src/nav/schema.ts) structurally
 * rather than importing it: @prefab/blocks's index.ts barrel is wired
 * centrally (see packages/blocks/src/index.ts) and this block isn't listed
 * there yet, so the named export isn't reachable through the package's
 * public surface. Field-shape typing only needs structural equivalence.
 */
type NavFieldsProps = {
  brand: string;
  links: { label: string; href: string }[];
};

export const navFields: Fields<NavFieldsProps> = {
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
