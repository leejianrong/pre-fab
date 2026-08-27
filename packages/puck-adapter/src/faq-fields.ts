import type { Fields } from "@puckeditor/core";
import type { FaqProps } from "@prefab/blocks";

export const faqFields: Fields<FaqProps> = {
  items: {
    type: "array",
    label: "Questions",
    max: 12,
    getItemSummary: (item) => item.question || "Question",
    arrayFields: {
      question: { type: "text", label: "Question" },
      answer: { type: "textarea", label: "Answer" },
    },
    defaultItemProps: { question: "New question", answer: "New answer" },
  },
};
