import type { Fields } from "@puckeditor/core";

/**
 * Mirrors `SpacerProps` (packages/blocks/src/spacer/schema.ts) structurally
 * rather than importing it: @prefab/blocks's index.ts barrel is wired
 * centrally (see packages/blocks/src/index.ts) and this block isn't listed
 * there yet, so the named export isn't reachable through the package's
 * public surface. Field-shape typing only needs structural equivalence.
 */
type SpacerFieldsProps = {
  height: "xs" | "sm" | "element" | "lg" | "section";
};

export const spacerFields: Fields<SpacerFieldsProps> = {
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
