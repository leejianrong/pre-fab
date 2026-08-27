import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

/**
 * `html` is plain text, not markup — this slice has no rich text editor
 * widget, so treating the field as HTML would mean parsing/sanitising
 * untrusted content with no library in the dependency graph to do it
 * safely. Instead the component below splits `html` on blank lines into
 * paragraphs and lets React escape each one as ordinary text content, so no
 * HTML is ever actually parsed from it (no XSS surface, no
 * dangerouslySetInnerHTML). The field name stays `html` to match
 * SLICES.md's "rich text" block-library entry; a future slice that adds a
 * real rich text editor can widen this without a prop rename.
 */
export const RichTextPropsSchema = z
  .object({
    html: z.string().max(4000).default(""),
    size: z.enum(["body", "lg"]).default("body"),
    align: z.enum(["left", "center"]).default("left"),
  })
  .strict();

export type RichTextProps = z.infer<typeof RichTextPropsSchema>;

export const RICHTEXT_BLOCK_TYPE = "richtext";
export const RICHTEXT_BLOCK_VERSION = 1;

export const richTextDefaultProps: RichTextProps = {
  html: "Write a paragraph here.\n\nSeparate paragraphs with a blank line.",
  size: "body",
  align: "left",
};

export const richTextBlockDefinition: BlockTypeDefinition<RichTextProps> = {
  type: RICHTEXT_BLOCK_TYPE,
  version: RICHTEXT_BLOCK_VERSION,
  propsSchema: RichTextPropsSchema,
  defaultProps: richTextDefaultProps,
  migrations: {},
};
