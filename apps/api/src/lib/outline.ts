import type { PoolClient } from "@prefab/db";
import { listPagesForSite, getPageDocument } from "@prefab/db";
import { blockSummaries } from "@prefab/blocks";
import type { SiteRow } from "@prefab/db";

export interface SiteOutline {
  site: { id: string; slug: string; name: string };
  pages: Array<{
    id: string;
    slug: string;
    title: string;
    blocks: Array<{ id: string; type: string; summary: string }>;
  }>;
}

/** R14: an agent orients on an unfamiliar site in one call — every page and block, with ids, types and a one-line summary. */
export async function buildSiteOutline(client: PoolClient, site: SiteRow): Promise<SiteOutline> {
  const pageRefs = await listPagesForSite(client, site.id);
  const pages = await Promise.all(
    pageRefs.map(async (ref) => {
      const document = await getPageDocument(client, ref.id);
      const blocks = (document?.blocks ?? []).map((block) => ({
        id: block.id,
        type: block.type,
        summary: blockSummaries[block.type]?.(block.props) ?? "",
      }));
      return { id: ref.id, slug: ref.slug, title: ref.title, blocks };
    }),
  );

  return {
    site: { id: site.id, slug: site.slug, name: site.name },
    pages,
  };
}
