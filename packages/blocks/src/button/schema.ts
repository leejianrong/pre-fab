import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

export const ButtonPropsSchema = z
  .object({
    label: z.string().min(1).max(60),
    href: z.string().min(1).max(2048),
    variant: z.enum(["primary", "secondary", "ghost"]).default("primary"),
    align: z.enum(["left", "center", "right"]).default("left"),
  })
  .strict();

export type ButtonProps = z.infer<typeof ButtonPropsSchema>;

export const BUTTON_BLOCK_TYPE = "button";
export const BUTTON_BLOCK_VERSION = 1;

export const buttonDefaultProps: ButtonProps = {
  label: "Learn more",
  href: "#",
  variant: "primary",
  align: "left",
};

export const buttonBlockDefinition: BlockTypeDefinition<ButtonProps> = {
  type: BUTTON_BLOCK_TYPE,
  version: BUTTON_BLOCK_VERSION,
  propsSchema: ButtonPropsSchema,
  defaultProps: buttonDefaultProps,
  migrations: {},
};
