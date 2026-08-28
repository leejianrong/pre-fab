import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

/**
 * Same "no asset subsystem yet" note as image/schema.ts: each item is a
 * plain URL string, not a reference into anything real.
 */
export const GalleryImageSchema = z
  .object({
    src: z.string().max(2048),
    alt: z.string().max(240).default(""),
  })
  .strict();

export type GalleryImage = z.infer<typeof GalleryImageSchema>;

export const GalleryPropsSchema = z
  .object({
    images: z.array(GalleryImageSchema).max(12).default([]),
    /**
     * This block's own base column count — independent of the
     * responsive-override `columns` field on BlockNode (SLICES.md's
     * per-breakpoint override), which this block also honours via
     * `columnsProperty` on `<ResponsiveStyle>` (see Gallery.tsx).
     */
    columns: z.number().int().min(1).max(4).default(3),
  })
  .strict();

export type GalleryProps = z.infer<typeof GalleryPropsSchema>;

export const GALLERY_BLOCK_TYPE = "gallery";
export const GALLERY_BLOCK_VERSION = 1;

export const galleryDefaultProps: GalleryProps = {
  images: [
    { src: "https://placehold.co/600x600", alt: "" },
    { src: "https://placehold.co/600x600", alt: "" },
    { src: "https://placehold.co/600x600", alt: "" },
  ],
  columns: 3,
};

export const galleryBlockDefinition: BlockTypeDefinition<GalleryProps> = {
  type: GALLERY_BLOCK_TYPE,
  version: GALLERY_BLOCK_VERSION,
  propsSchema: GalleryPropsSchema,
  defaultProps: galleryDefaultProps,
  migrations: {},
};
