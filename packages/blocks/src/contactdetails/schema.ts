import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

export const ContactDetailsPropsSchema = z
  .object({
    heading: z.string().max(120).default("Contact us"),
    email: z.string().max(320).default(""),
    phone: z.string().max(40).default(""),
    address: z.string().max(400).default(""),
  })
  .strict();

export type ContactDetailsProps = z.infer<typeof ContactDetailsPropsSchema>;

export const CONTACTDETAILS_BLOCK_TYPE = "contactdetails";
export const CONTACTDETAILS_BLOCK_VERSION = 1;

export const contactdetailsDefaultProps: ContactDetailsProps = {
  heading: "Contact us",
  email: "hello@example.com",
  phone: "+1 (555) 010-0100",
  address: "123 Main Street\nSpringfield, USA",
};

export const contactdetailsBlockDefinition: BlockTypeDefinition<ContactDetailsProps> = {
  type: CONTACTDETAILS_BLOCK_TYPE,
  version: CONTACTDETAILS_BLOCK_VERSION,
  propsSchema: ContactDetailsPropsSchema,
  defaultProps: contactdetailsDefaultProps,
  migrations: {},
};
