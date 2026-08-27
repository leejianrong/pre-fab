import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

export const NavLinkSchema = z
  .object({
    label: z.string().min(1).max(60),
    href: z.string().min(1).max(2048),
  })
  .strict();

export type NavLink = z.infer<typeof NavLinkSchema>;

export const NavPropsSchema = z
  .object({
    brand: z.string().max(80).default("Your Business"),
    links: z.array(NavLinkSchema).max(8).default([]),
  })
  .strict();

export type NavProps = z.infer<typeof NavPropsSchema>;

export const NAV_BLOCK_TYPE = "nav";
export const NAV_BLOCK_VERSION = 1;

export const navDefaultProps: NavProps = {
  brand: "Your Business",
  links: [],
};

export const navBlockDefinition: BlockTypeDefinition<NavProps> = {
  type: NAV_BLOCK_TYPE,
  version: NAV_BLOCK_VERSION,
  propsSchema: NavPropsSchema,
  defaultProps: navDefaultProps,
  migrations: {},
};
