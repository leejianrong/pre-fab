import type { Fields } from "@puckeditor/core";
import type { ColumnsProps } from "@prefab/blocks";

export const columnsFields: Fields<ColumnsProps> = {
  count: { type: "number", label: "Column count", min: 2, max: 4 },
  gap: {
    type: "select",
    label: "Gap",
    options: [
      { label: "Extra small", value: "xs" },
      { label: "Small", value: "sm" },
      { label: "Element", value: "element" },
      { label: "Large", value: "lg" },
      { label: "Section", value: "section" },
    ],
  },
};
