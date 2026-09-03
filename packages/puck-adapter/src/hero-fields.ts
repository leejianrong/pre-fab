import type { Fields } from "@puckeditor/core";
import type { HeroProps } from "@prefab/blocks";

/**
 * Hand-mapped from HeroPropsSchema to Puck's inspector field types. One
 * block type in slice 1, so a generic zod-schema -> Puck-Fields transformer
 * is not worth building yet; every first-party block adds its own fields
 * module like this one, next to its schema.
 */
export const heroFields: Fields<HeroProps> = {
  heading: { type: "text", label: "Heading" },
  subheading: { type: "textarea", label: "Subheading" },
  ctaLabel: { type: "text", label: "Button label" },
  ctaHref: { type: "text", label: "Button link" },
  background: {
    type: "select",
    label: "Background",
    options: [
      { label: "Background", value: "background" },
      { label: "Accent", value: "accent" },
    ],
  },
  backgroundImage: { type: "text", label: "Background image URL (optional, full-bleed)" },
};
