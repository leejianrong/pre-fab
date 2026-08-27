/**
 * A single field-level problem, always anchored to the block it came from —
 * R18: "Invalid input is rejected wholesale, naming the block id and field
 * path."
 */
export interface ValidationIssue {
  blockId: string | null;
  path: (string | number)[];
  message: string;
}

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

/** Thrown when a block or document schemaVersion has no migration path forward. */
export class MigrationGapError extends SchemaError {
  constructor(
    public readonly blockType: string,
    public readonly fromVersion: number,
  ) {
    super(
      `no migration registered for block type "${blockType}" from schemaVersion ${fromVersion}`,
    );
    this.name = "MigrationGapError";
  }
}
