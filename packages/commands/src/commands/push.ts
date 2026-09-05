import type { Command } from "../registry.js";
import type { CommandContext } from "../context.js";
import { ApiClientError } from "@prefab/api-client";
import { readCheckoutPages, readCheckoutPosts, readCheckoutSite, readCheckoutTheme } from "../checkout.js";

export interface PushArgs {
  dir: string;
}

export interface PushResult {
  pushed: string[];
}

async function isNotFound(error: unknown): Promise<boolean> {
  return error instanceof ApiClientError && error.code === "not_found";
}

async function runPush(ctx: CommandContext, args: PushArgs): Promise<PushResult> {
  const site = await readCheckoutSite(args.dir);
  const pushed: string[] = [];

  try {
    const theme = await readCheckoutTheme(args.dir);
    await ctx.api.updateTheme(site.id, theme.tokens);
    pushed.push("theme.json");
  } catch (error) {
    if (!(await isNotFound(error)) && !isFileMissing(error)) throw error;
  }

  const pages = await readCheckoutPages(args.dir);
  for (const page of pages) {
    let pageId = page.id;
    let expectedVersion = page.version;

    try {
      await ctx.api.getPage(site.id, page.id);
    } catch (error) {
      if (!(await isNotFound(error))) throw error;
      // Not on the target site yet (e.g. a page added to the checkout by
      // hand). Block identity still survives the round trip (R8) even
      // though the *page's own* id is minted fresh here — createPage
      // mints a page id server-side, but every block keeps the id it
      // already had in the file.
      const created = await ctx.api.createPage(site.id, { slug: page.slug, title: page.title });
      pageId = created.id;
      expectedVersion = created.version;
    }

    await ctx.api.writePage(site.id, pageId, {
      title: page.title,
      slug: page.slug,
      blocks: page.blocks,
      // ADR-0014 / KAN-1129: threaded through so a "free"-layout page's
      // checked-out file round-trips (R8) instead of silently reverting to
      // "flow" on every push/import.
      layoutMode: page.layoutMode,
      expectedVersion,
    });
    pushed.push(`pages/${page.slug}.json`);
  }

  const posts = await readCheckoutPosts(args.dir);
  for (const post of posts) {
    let postId = post.id;
    let expectedVersion = post.version;

    try {
      await ctx.api.getPost(site.id, post.id);
    } catch (error) {
      if (!(await isNotFound(error))) throw error;
      // Same reasoning as a page added to the checkout by hand: the post's
      // own id is minted fresh server-side, but its slug and content
      // survive the round trip (R8).
      const created = await ctx.api.createPost(site.id, {
        title: post.title,
        slug: post.slug,
        date: post.date,
        author: post.author,
        tags: post.tags,
        cover: post.cover,
        body: post.body,
        locale: post.locale,
        status: post.status,
      });
      postId = created.id;
      expectedVersion = created.version;
    }

    await ctx.api.writePost(site.id, postId, {
      title: post.title,
      slug: post.slug,
      date: post.date,
      author: post.author,
      tags: post.tags,
      cover: post.cover,
      body: post.body,
      locale: post.locale,
      status: post.status,
      expectedVersion,
    });
    pushed.push(`posts/${post.slug}.md`);
  }

  return { pushed };
}

function isFileMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}

export const push: Command<PushArgs, PushResult> = {
  name: "push",
  mutation: "page.write",
  description: "Send a local checkout back through the same validation and version check as any other write (ADR-0002)",
  run: runPush,
};

/** Same mechanism as `push` — importing IS pushing a checkout, whatever produced it (a fresh export, a template, hand edits). */
export const importSite: Command<PushArgs, PushResult> = {
  name: "import",
  description: "Import a file tree, validating and version-checking every page exactly like any other write",
  run: runPush,
};
