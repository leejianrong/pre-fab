import type { Fields } from "@puckeditor/core";
import type { PostListProps } from "@prefab/blocks";

export const postListFields: Fields<PostListProps> = {
  heading: { type: "text", label: "Heading" },
  postsPerPage: { type: "number", label: "Posts per page", min: 1, max: 50 },
  showExcerpt: { type: "radio", label: "Show excerpt", options: [{ label: "Yes", value: true }, { label: "No", value: false }] },
};
