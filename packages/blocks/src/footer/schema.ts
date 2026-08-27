import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

export const FooterLinkSchema = z
  .object({
    label: z.string().min(1).max(60),
    href: z.string().min(1).max(2048),
  })
  .strict();

export type FooterLink = z.infer<typeof FooterLinkSchema>;

export const FooterPropsSchema = z
  .object({
    text: z.string().max(200).default("© Your Company"),
    links: z.array(FooterLinkSchema).max(6).default([]),
  })
  .strict();

export type FooterProps = z.infer<typeof FooterPropsSchema>;

export const FOOTER_BLOCK_TYPE = "footer";
export const FOOTER_BLOCK_VERSION = 1;

export const footerDefaultProps: FooterProps = {
  text: "© Your Company",
  links: [],
};

export const footerBlockDefinition: BlockTypeDefinition<FooterProps> = {
  type: FOOTER_BLOCK_TYPE,
  version: FOOTER_BLOCK_VERSION,
  propsSchema: FooterPropsSchema,
  defaultProps: footerDefaultProps,
  migrations: {},
};
