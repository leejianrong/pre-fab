import { z } from "zod";
import type { BlockTypeDefinition } from "@prefab/schema";

export const CardSchema = z
  .object({
    title: z.string().max(120),
    body: z.string().max(400),
    href: z.string().max(2048).default(""),
  })
  .strict();

export type Card = z.infer<typeof CardSchema>;

export const CardGridPropsSchema = z
  .object({
    cards: z.array(CardSchema).max(9).default([]),
    /**
     * This block's own base column count — independent of the
     * responsive-override `columns` field on BlockNode, which this block
     * also honours via `columnsProperty` on `<ResponsiveStyle>` (see
     * CardGrid.tsx), same pattern as gallery/Gallery.tsx.
     */
    columns: z.number().int().min(1).max(3).default(3),
  })
  .strict();

export type CardGridProps = z.infer<typeof CardGridPropsSchema>;

export const CARDGRID_BLOCK_TYPE = "cardgrid";
export const CARDGRID_BLOCK_VERSION = 1;

export const cardGridDefaultProps: CardGridProps = {
  cards: [
    { title: "First feature", body: "A sentence describing what this offers.", href: "" },
    { title: "Second feature", body: "A sentence describing what this offers.", href: "" },
    { title: "Third feature", body: "A sentence describing what this offers.", href: "" },
  ],
  columns: 3,
};

export const cardGridBlockDefinition: BlockTypeDefinition<CardGridProps> = {
  type: CARDGRID_BLOCK_TYPE,
  version: CARDGRID_BLOCK_VERSION,
  propsSchema: CardGridPropsSchema,
  defaultProps: cardGridDefaultProps,
  migrations: {},
};
