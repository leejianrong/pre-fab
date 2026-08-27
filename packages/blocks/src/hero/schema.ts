import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

/**
 * `background` selects a theme *token name*, never a raw colour — the
 * component resolves it to `var(--pf-color-<name>)` at render time. This is
 * the concrete form of "blocks reference tokens, never raw values."
 */
export const HeroPropsSchema = z
  .object({
    heading: z.string().min(1).max(120),
    subheading: z.string().max(240).default(""),
    ctaLabel: z.string().max(40).default(""),
    ctaHref: z.string().max(2048).default(""),
    background: z.enum(["background", "accent"]).default("background"),
  })
  .strict();

export type HeroProps = z.infer<typeof HeroPropsSchema>;

export const HERO_BLOCK_TYPE = "hero";
export const HERO_BLOCK_VERSION = 1;

export const heroDefaultProps: HeroProps = {
  heading: "Your headline goes here",
  subheading: "A sentence that says what you do and for whom.",
  ctaLabel: "Get in touch",
  ctaHref: "#contact",
  background: "background",
};

export const heroBlockDefinition: BlockTypeDefinition<HeroProps> = {
  type: HERO_BLOCK_TYPE,
  version: HERO_BLOCK_VERSION,
  propsSchema: HeroPropsSchema,
  defaultProps: heroDefaultProps,
  migrations: {},
};
