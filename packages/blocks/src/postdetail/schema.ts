import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

/** No configurable props — placing this block on a page turns it into that page's per-post detail template (@prefab/publish's page-template.ts). */
export const PostDetailPropsSchema = z.object({}).strict();

export type PostDetailProps = z.infer<typeof PostDetailPropsSchema>;

export const POSTDETAIL_BLOCK_TYPE = "postdetail";
export const POSTDETAIL_BLOCK_VERSION = 1;

export const postDetailDefaultProps: PostDetailProps = {};

export const postDetailBlockDefinition: BlockTypeDefinition<PostDetailProps> = {
  type: POSTDETAIL_BLOCK_TYPE,
  version: POSTDETAIL_BLOCK_VERSION,
  propsSchema: PostDetailPropsSchema,
  defaultProps: postDetailDefaultProps,
  migrations: {},
};
