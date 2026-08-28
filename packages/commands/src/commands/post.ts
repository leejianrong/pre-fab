import type { Command } from "../registry.js";
import type { CreatePostInput, ListPostsQuery, ListPostsResult, PostDocument, WritePostInput } from "@prefab/api-client";

export const postCreate: Command<{ siteId: string } & CreatePostInput, PostDocument> = {
  name: "post.create",
  mutation: "post.create",
  description: "Create a new blog post — an omitted slug is generated from the title (Slice 5)",
  run: (ctx, args) => {
    const { siteId, ...input } = args;
    return ctx.api.createPost(siteId, input);
  },
};

export const postList: Command<{ siteId: string } & ListPostsQuery, ListPostsResult> = {
  name: "post.list",
  description: "List a site's blog posts, paginated",
  run: (ctx, args) => {
    const { siteId, ...query } = args;
    return ctx.api.listPosts(siteId, query);
  },
};

export const postGet: Command<{ siteId: string; postId: string }, PostDocument> = {
  name: "post.get",
  description: "Get a blog post document",
  run: (ctx, args) => ctx.api.getPost(args.siteId, args.postId),
};

export const postWrite: Command<{ siteId: string; postId: string } & WritePostInput, PostDocument> = {
  name: "post.write",
  mutation: "post.write",
  description: "Replace a blog post's fields (whole-document, optimistic-concurrency write — R17/R18)",
  run: (ctx, args) => {
    const { siteId, postId, ...input } = args;
    return ctx.api.writePost(siteId, postId, input);
  },
};
