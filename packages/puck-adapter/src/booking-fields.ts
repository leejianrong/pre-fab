import type { Fields } from "@puckeditor/core";
import type { BookingProps } from "@prefab/blocks";

export const bookingFields: Fields<BookingProps> = {
  heading: { type: "text", label: "Heading" },
  description: { type: "textarea", label: "Description" },
  confirmLabel: { type: "text", label: "Confirm button label" },
  successMessage: { type: "text", label: "Success message" },
};
