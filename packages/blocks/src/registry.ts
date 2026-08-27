import type { ComponentType } from "react";
import { BlockRegistry, type BlockTypeDefinition } from "@prefab/schema";
import { Hero } from "./hero/Hero.js";
import { heroBlockDefinition, type HeroProps } from "./hero/schema.js";
import { Heading } from "./heading/Heading.js";
import { headingBlockDefinition, type HeadingProps } from "./heading/schema.js";
import { Button } from "./button/Button.js";
import { buttonBlockDefinition, type ButtonProps } from "./button/schema.js";

/**
 * One entry per first-party block: its schema-half definition
 * (@prefab/schema's validate/migrate machinery), its component, and a
 * one-line summary function for `site outline` (R14). Adding a block is
 * adding one entry here — the three exports below (`blockSchemaRegistry`,
 * `blockComponents`, `blockSummaries`) are derived, not hand-maintained in
 * parallel, so they can't drift out of sync with each other.
 */
// Heterogeneous by design — see BlockRegistry's own note in @prefab/schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface BlockEntry<P extends Record<string, unknown> = any> {
  definition: BlockTypeDefinition<P>;
  Component: ComponentType<P>;
  summary: (props: P) => string;
}

const BLOCK_ENTRIES: BlockEntry[] = [
  { definition: heroBlockDefinition, Component: Hero, summary: (props: HeroProps) => props.heading },
  { definition: headingBlockDefinition, Component: Heading, summary: (props: HeadingProps) => props.text },
  { definition: buttonBlockDefinition, Component: Button, summary: (props: ButtonProps) => props.label },
];

/**
 * The schema half, ready to hand to @prefab/schema's validate/migrate
 * functions. Every first-party block registers itself here.
 */
export const blockSchemaRegistry = BLOCK_ENTRIES.reduce(
  (registry, entry) => registry.register(entry.definition),
  new BlockRegistry(),
);

/**
 * The render half. Kept as a plain map rather than folded into the schema
 * registry, because the schema registry must stay importable from packages
 * that do not want React in their dependency graph (e.g. a future CLI-only
 * validation path).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const blockComponents: Record<string, ComponentType<any>> = Object.fromEntries(
  BLOCK_ENTRIES.map((entry) => [entry.definition.type, entry.Component]),
);

/** One-line summary per block type, for `site outline` (R14) — an agent orients without opening every page. */
export const blockSummaries: Record<string, (props: Record<string, unknown>) => string> = Object.fromEntries(
  BLOCK_ENTRIES.map((entry) => [entry.definition.type, entry.summary as (props: Record<string, unknown>) => string]),
);

