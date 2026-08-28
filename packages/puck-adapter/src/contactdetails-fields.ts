import type { Fields } from "@puckeditor/core";
import type { ContactDetailsProps } from "@prefab/blocks";

export const contactdetailsFields: Fields<ContactDetailsProps> = {
  heading: { type: "text", label: "Heading" },
  email: { type: "text", label: "Email (optional)" },
  phone: { type: "text", label: "Phone (optional)" },
  address: { type: "textarea", label: "Address (optional)" },
};
