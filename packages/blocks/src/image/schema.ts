import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

/**
 * There is no asset-upload subsystem yet (built in parallel, out of scope
 * here) — a "picked image" is modelled as a plain URL string prop for now.
 * `radius` selects a theme *token name* (or "none"), never a raw radius —
 * the same pattern Hero's `background` field documents.
 */
export const ImagePropsSchema = z
  .object({
    src: z.string().max(2048).default("https://placehold.co/1200x630"),
    alt: z.string().max(240).default(""),
    caption: z.string().max(240).default(""),
    radius: z.enum(["control", "card", "full", "none"]).default("card"),
  })
  .strict();

export type ImageProps = z.infer<typeof ImagePropsSchema>;

export const IMAGE_BLOCK_TYPE = "image";
export const IMAGE_BLOCK_VERSION = 1;

export const imageDefaultProps: ImageProps = {
  src: "https://placehold.co/1200x630",
  alt: "",
  caption: "",
  radius: "card",
};

export const imageBlockDefinition: BlockTypeDefinition<ImageProps> = {
  type: IMAGE_BLOCK_TYPE,
  version: IMAGE_BLOCK_VERSION,
  propsSchema: ImagePropsSchema,
  defaultProps: imageDefaultProps,
  migrations: {},
};
