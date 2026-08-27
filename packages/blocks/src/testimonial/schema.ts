import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

export const TestimonialPropsSchema = z
  .object({
    quote: z.string().min(1).max(400),
    author: z.string().min(1).max(120),
    /** Job title/company, e.g. "CEO, Acme Inc." — omit the byline entirely when empty. */
    role: z.string().max(120).default(""),
  })
  .strict();

export type TestimonialProps = z.infer<typeof TestimonialPropsSchema>;

export const TESTIMONIAL_BLOCK_TYPE = "testimonial";
export const TESTIMONIAL_BLOCK_VERSION = 1;

export const testimonialDefaultProps: TestimonialProps = {
  quote: "This is the best product we've used for our website. It just works.",
  author: "Jamie Rivera",
  role: "Founder, Acme Co.",
};

export const testimonialBlockDefinition: BlockTypeDefinition<TestimonialProps> = {
  type: TESTIMONIAL_BLOCK_TYPE,
  version: TESTIMONIAL_BLOCK_VERSION,
  propsSchema: TestimonialPropsSchema,
  defaultProps: testimonialDefaultProps,
  migrations: {},
};
