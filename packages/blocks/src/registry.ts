import type { ComponentType } from "react";
import { BlockRegistry } from "@prefab/schema";
import { Hero } from "./hero/Hero.js";
import { HERO_BLOCK_TYPE, heroBlockDefinition, type HeroProps } from "./hero/schema.js";

/**
 * The schema half, ready to hand to @prefab/schema's validate/migrate
 * functions. Every first-party block registers itself here.
 */
export const blockSchemaRegistry = new BlockRegistry().register(heroBlockDefinition);

/**
 * The render half. Kept as a plain map rather than folded into the schema
 * registry, because the schema registry must stay importable from packages
 * that do not want React in their dependency graph (e.g. a future CLI-only
 * validation path).
 */
// A heterogeneous registry (each block type has its own, different props
// shape) is exactly what `any` exists for here — a narrower type would
// have to be unsound to let every block type's component actually fit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const blockComponents: Record<string, ComponentType<any>> = {
  [HERO_BLOCK_TYPE]: Hero,
};

/** One-line summary per block type, for `site outline` (R14) — an agent orients without opening every page. */
export const blockSummaries: Record<string, (props: Record<string, unknown>) => string> = {
  [HERO_BLOCK_TYPE]: (props) => String(props.heading ?? ""),
};

export type { HeroProps };
