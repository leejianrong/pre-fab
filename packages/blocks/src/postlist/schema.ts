import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

export const PostListPropsSchema = z
  .object({
    heading: z.string().max(120).default("Latest posts"),
    postsPerPage: z.number().int().min(1).max(50).default(10),
    showExcerpt: z.boolean().default(true),
  })
  .strict();

export type PostListProps = z.infer<typeof PostListPropsSchema>;

export const POSTLIST_BLOCK_TYPE = "postlist";
export const POSTLIST_BLOCK_VERSION = 1;

export const postListDefaultProps: PostListProps = {
  heading: "Latest posts",
  postsPerPage: 10,
  showExcerpt: true,
};

export const postListBlockDefinition: BlockTypeDefinition<PostListProps> = {
  type: POSTLIST_BLOCK_TYPE,
  version: POSTLIST_BLOCK_VERSION,
  propsSchema: PostListPropsSchema,
  defaultProps: postListDefaultProps,
  migrations: {},
};
