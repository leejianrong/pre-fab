import type { z } from "zod";
import { MigrationGapError } from "./errors.js";

/**
 * The schema half of PLAN.md mechanism 6 ("a block is a schema, a React
 * component and a migration chain"). This package only ever sees the schema
 * half — the component lives in @prefab/blocks, which depends on this
 * package rather than the reverse, so validation and migration work with no
 * framework in the dependency graph at all.
 */
export interface BlockTypeDefinition<Props = Record<string, unknown>> {
  readonly type: string;
  /** Current schemaVersion this definition validates and produces. */
  readonly version: number;
  readonly propsSchema: z.ZodType<Props>;
  readonly defaultProps: Props;
  /**
   * Forward-only migrations, keyed by the schemaVersion being migrated
   * *from*. `migrations[3]` takes v3 props and returns v4 props.
   */
  readonly migrations: Record<number, (props: Record<string, unknown>) => Record<string, unknown>>;
}

export class BlockRegistry {
  // Heterogeneous by design — each block type has its own Props type, so
  // the registry's internal storage can't be narrower than `any` without
  // being unsound for whichever type isn't the one you happened to pick.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly definitions = new Map<string, BlockTypeDefinition<any>>();

  register<Props>(definition: BlockTypeDefinition<Props>): this {
    this.definitions.set(definition.type, definition);
    return this;
  }

  get(type: string): BlockTypeDefinition | undefined {
    return this.definitions.get(type);
  }

  has(type: string): boolean {
    return this.definitions.has(type);
  }

  types(): string[] {
    return [...this.definitions.keys()];
  }
}

/**
 * Runs `props` forward through the definition's migration chain until it
 * reaches `definition.version`. Throws MigrationGapError rather than
 * guessing when a step is missing — a silent partial migration is worse
 * than a loud failure.
 */
export function migrateBlockProps(
  definition: BlockTypeDefinition,
  props: Record<string, unknown>,
  fromVersion: number,
): Record<string, unknown> {
  let version = fromVersion;
  let current = props;
  while (version < definition.version) {
    const step = definition.migrations[version];
    if (!step) {
      throw new MigrationGapError(definition.type, version);
    }
    current = step(current);
    version += 1;
  }
  return current;
}
