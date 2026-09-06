import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

export const ProductGridPropsSchema = z
  .object({
    heading: z.string().max(120).default("Shop"),
    productsPerPage: z.number().int().min(1).max(50).default(12),
    /**
     * This block's own base column count — same "own column count,
     * independent of the responsive-override `columns` field on
     * BlockNode" pattern gallery/cardgrid already use.
     */
    columns: z.number().int().min(1).max(4).default(3),
    showPrice: z.boolean().default(true),
  })
  .strict();

export type ProductGridProps = z.infer<typeof ProductGridPropsSchema>;

export const PRODUCTGRID_BLOCK_TYPE = "productgrid";
export const PRODUCTGRID_BLOCK_VERSION = 1;

export const productGridDefaultProps: ProductGridProps = {
  heading: "Shop",
  productsPerPage: 12,
  columns: 3,
  showPrice: true,
};

export const productGridBlockDefinition: BlockTypeDefinition<ProductGridProps> = {
  type: PRODUCTGRID_BLOCK_TYPE,
  version: PRODUCTGRID_BLOCK_VERSION,
  propsSchema: ProductGridPropsSchema,
  defaultProps: productGridDefaultProps,
  migrations: {},
};
