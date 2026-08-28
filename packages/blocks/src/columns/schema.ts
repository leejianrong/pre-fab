import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

/**
 * `gap` selects a theme spacing token *name*, never a raw size — same
 * pattern as every other token-valued field in this package.
 */
export const ColumnsPropsSchema = z
  .object({
    count: z.number().int().min(2).max(4).default(2),
    gap: z.enum(["xs", "sm", "element", "lg", "section"]).default("element"),
  })
  .strict();

export type ColumnsProps = z.infer<typeof ColumnsPropsSchema>;

export const COLUMNS_BLOCK_TYPE = "columns";
export const COLUMNS_BLOCK_VERSION = 1;

export const columnsDefaultProps: ColumnsProps = {
  count: 2,
  gap: "element",
};

export const columnsBlockDefinition: BlockTypeDefinition<ColumnsProps> = {
  type: COLUMNS_BLOCK_TYPE,
  version: COLUMNS_BLOCK_VERSION,
  propsSchema: ColumnsPropsSchema,
  defaultProps: columnsDefaultProps,
  migrations: {},
};
