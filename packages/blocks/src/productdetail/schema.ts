import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

/** No configurable props — placing this block on a page turns it into that page's per-product detail template (@prefab/publish's page-template.ts), mirroring postdetail/schema.ts exactly. */
export const ProductDetailPropsSchema = z.object({}).strict();

export type ProductDetailProps = z.infer<typeof ProductDetailPropsSchema>;

export const PRODUCTDETAIL_BLOCK_TYPE = "productdetail";
export const PRODUCTDETAIL_BLOCK_VERSION = 1;

export const productDetailDefaultProps: ProductDetailProps = {};

export const productDetailBlockDefinition: BlockTypeDefinition<ProductDetailProps> = {
  type: PRODUCTDETAIL_BLOCK_TYPE,
  version: PRODUCTDETAIL_BLOCK_VERSION,
  propsSchema: ProductDetailPropsSchema,
  defaultProps: productDetailDefaultProps,
  migrations: {},
};
