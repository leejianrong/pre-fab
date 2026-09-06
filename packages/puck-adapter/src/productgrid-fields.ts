import type { Fields } from "@puckeditor/core";
import type { ProductGridProps } from "@prefab/blocks";

export const productGridFields: Fields<ProductGridProps> = {
  heading: { type: "text", label: "Heading" },
  productsPerPage: { type: "number", label: "Products per page", min: 1, max: 50 },
  columns: { type: "number", label: "Columns", min: 1, max: 4 },
  showPrice: { type: "radio", label: "Show price", options: [{ label: "Yes", value: true }, { label: "No", value: false }] },
};
