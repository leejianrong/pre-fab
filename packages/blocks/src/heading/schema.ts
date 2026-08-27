import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

export const HeadingPropsSchema = z
  .object({
    text: z.string().min(1).max(160),
    level: z.enum(["h1", "h2", "h3"]).default("h2"),
    /** Token *name* in the theme's fontSize scale, never a raw size (invariant 2). */
    size: z.enum(["body", "lg", "heading", "display"]).default("heading"),
    align: z.enum(["left", "center", "right"]).default("left"),
  })
  .strict();

export type HeadingProps = z.infer<typeof HeadingPropsSchema>;

export const HEADING_BLOCK_TYPE = "heading";
export const HEADING_BLOCK_VERSION = 1;

export const headingDefaultProps: HeadingProps = {
  text: "Section heading",
  level: "h2",
  size: "heading",
  align: "left",
};

export const headingBlockDefinition: BlockTypeDefinition<HeadingProps> = {
  type: HEADING_BLOCK_TYPE,
  version: HEADING_BLOCK_VERSION,
  propsSchema: HeadingPropsSchema,
  defaultProps: headingDefaultProps,
  migrations: {},
};
