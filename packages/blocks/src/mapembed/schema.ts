import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

export const MapEmbedPropsSchema = z
  .object({
    /** A place name or address to search, e.g. "1600 Amphitheatre Parkway, Mountain View, CA". */
    query: z.string().max(400).default(""),
    /**
     * Layout height bucket. Not a theme token — these are pixel dimensions
     * for an iframe embed (a structural layout size), not a color/spacing/
     * type value the theme's swappable token scale governs.
     */
    height: z.enum(["sm", "md", "lg"]).default("md"),
  })
  .strict();

export type MapEmbedProps = z.infer<typeof MapEmbedPropsSchema>;

export const MAPEMBED_BLOCK_TYPE = "mapembed";
export const MAPEMBED_BLOCK_VERSION = 1;

export const mapembedDefaultProps: MapEmbedProps = {
  query: "1600 Amphitheatre Parkway, Mountain View, CA",
  height: "md",
};

export const mapembedBlockDefinition: BlockTypeDefinition<MapEmbedProps> = {
  type: MAPEMBED_BLOCK_TYPE,
  version: MAPEMBED_BLOCK_VERSION,
  propsSchema: MapEmbedPropsSchema,
  defaultProps: mapembedDefaultProps,
  migrations: {},
};
