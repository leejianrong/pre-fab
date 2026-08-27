import type { Fields } from "@puckeditor/core";
import type { TestimonialProps } from "@prefab/blocks/testimonial";

export const testimonialFields: Fields<TestimonialProps> = {
  quote: { type: "textarea", label: "Quote" },
  author: { type: "text", label: "Author" },
  role: { type: "text", label: "Role (optional)" },
};
