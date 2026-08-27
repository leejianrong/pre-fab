import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

/**
 * `height` selects a theme *token name* from the spacing scale, never a raw
 * pixel or rem literal — the component resolves it to
 * `var(--pf-spacing-<name>)` at render time (CLAUDE.md invariant 2).
 */
export const SpacerPropsSchema = z
  .object({
    height: z.enum(["xs", "sm", "element", "lg", "section"]).default("lg"),
  })
  .strict();

export type SpacerProps = z.infer<typeof SpacerPropsSchema>;

export const SPACER_BLOCK_TYPE = "spacer";
export const SPACER_BLOCK_VERSION = 1;

export const spacerDefaultProps: SpacerProps = {
  height: "lg",
};

export const spacerBlockDefinition: BlockTypeDefinition<SpacerProps> = {
  type: SPACER_BLOCK_TYPE,
  version: SPACER_BLOCK_VERSION,
  propsSchema: SpacerPropsSchema,
  defaultProps: spacerDefaultProps,
  migrations: {},
};
