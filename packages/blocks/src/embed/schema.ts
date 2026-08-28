import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

/**
 * The raw-HTML embed block (SLICES.md, [ASSUMED — no tenant-authored JS on
 * the site origin]). `html` is the tenant's own markup/script snippet
 * (e.g. a booking widget, a social embed) — deliberately unsanitised and
 * unvalidated as HTML, because sanitising it would defeat the point of a
 * "bring your own embed" block. Safety comes from where it's rendered
 * (Embed.tsx's sandboxed, opaque-origin iframe), not from what's allowed
 * in the string.
 */
export const EmbedPropsSchema = z
  .object({
    html: z.string().max(20_000).default(""),
    height: z.enum(["sm", "md", "lg"]).default("md"),
  })
  .strict();

export type EmbedProps = z.infer<typeof EmbedPropsSchema>;

export const EMBED_BLOCK_TYPE = "embed";
export const EMBED_BLOCK_VERSION = 1;

export const embedDefaultProps: EmbedProps = {
  html: "",
  height: "md",
};

export const embedBlockDefinition: BlockTypeDefinition<EmbedProps> = {
  type: EMBED_BLOCK_TYPE,
  version: EMBED_BLOCK_VERSION,
  propsSchema: EmbedPropsSchema,
  defaultProps: embedDefaultProps,
  migrations: {},
};
