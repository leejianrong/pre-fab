import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

export const FaqItemSchema = z
  .object({
    question: z.string().min(1).max(200),
    answer: z.string().min(1).max(1000),
  })
  .strict();

export type FaqItem = z.infer<typeof FaqItemSchema>;

export const FaqPropsSchema = z
  .object({
    items: z.array(FaqItemSchema).max(12).default([
      {
        question: "How does pricing work?",
        answer: "You pay a flat monthly fee for hosting; there are no per-visitor charges.",
      },
      {
        question: "Can I export my site?",
        answer: "Yes — your site is a portable file tree you own outright, at any time.",
      },
      {
        question: "Do I need to know how to code?",
        answer: "No. Everything is built with the visual editor; code is optional, not required.",
      },
    ]),
  })
  .strict();

export type FaqProps = z.infer<typeof FaqPropsSchema>;

export const FAQ_BLOCK_TYPE = "faq";
export const FAQ_BLOCK_VERSION = 1;

export const faqDefaultProps: FaqProps = FaqPropsSchema.parse({});

export const faqBlockDefinition: BlockTypeDefinition<FaqProps> = {
  type: FAQ_BLOCK_TYPE,
  version: FAQ_BLOCK_VERSION,
  propsSchema: FaqPropsSchema,
  defaultProps: faqDefaultProps,
  migrations: {},
};
