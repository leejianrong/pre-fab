import { z } from "zod";
import { DOCUMENT_SCHEMA_VERSION } from "./document.js";

/**
 * ADR-0010's tier (a) — a static bundle exported alongside a manifest
 * declaring the document schema version it was built from and how far
 * back an import can still be accepted from (QUESTIONS.md 12.3: "supported
 * for two major versions back, stated in the export manifest"). Kept in
 * @prefab/schema (not @prefab/publish or apps/self-host) because it is
 * pure, framework-free data both the control plane and the self-host
 * runtime need to read and write — the same reasoning @prefab/schema's own
 * module comment gives for being the one control-plane-shaped package
 * allowed on both sides of the runtime containment check.
 */
export const EXPORT_MANIFEST_FORMAT = "prefab-export-manifest" as const;

/** How many major schema versions back an import is still accepted from — QUESTIONS.md 12.3. */
export const SUPPORTED_IMPORT_VERSIONS_BACK = 2;

export const ExportManifestSchema = z.object({
  format: z.literal(EXPORT_MANIFEST_FORMAT),
  /** The document envelope schemaVersion (@prefab/schema's DOCUMENT_SCHEMA_VERSION) this export was built from. */
  schemaVersion: z.number().int().nonnegative(),
  /** Informational — the oldest schemaVersion this export's own author could still have imported at export time. Recomputed on import against the *importer's* current version; never trusted as the authority for whether the importer accepts it. */
  minSupportedSchemaVersion: z.number().int().nonnegative(),
  generatedAt: z.string(),
});

export type ExportManifest = z.infer<typeof ExportManifestSchema>;

export function minSupportedSchemaVersion(currentSchemaVersion: number, versionsBack: number = SUPPORTED_IMPORT_VERSIONS_BACK): number {
  return Math.max(0, currentSchemaVersion - versionsBack);
}

export function buildExportManifest(input: {
  schemaVersion?: number;
  now?: Date;
  versionsBack?: number;
}): ExportManifest {
  const schemaVersion = input.schemaVersion ?? DOCUMENT_SCHEMA_VERSION;
  return {
    format: EXPORT_MANIFEST_FORMAT,
    schemaVersion,
    minSupportedSchemaVersion: minSupportedSchemaVersion(schemaVersion, input.versionsBack),
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}

export interface ExportManifestCompatibility {
  compatible: boolean;
  reason?: string;
}

/**
 * The importer-side check: is this manifest's declared schemaVersion still
 * within the *current* codebase's supported import window? `currentSchemaVersion`
 * defaults to the live DOCUMENT_SCHEMA_VERSION but is an explicit parameter
 * — the same "inject what isn't real yet" shape as FakeDomainProvider/
 * FakeTurnstileVerifier — because this repo's schema has only ever been
 * version 1 (no real two-versions-old export exists yet to test against).
 * A manifest from the future (schemaVersion greater than what this build
 * understands) is never compatible, whatever the version-back window says.
 */
export function checkExportManifestCompatible(
  manifest: Pick<ExportManifest, "schemaVersion">,
  currentSchemaVersion: number = DOCUMENT_SCHEMA_VERSION,
  versionsBack: number = SUPPORTED_IMPORT_VERSIONS_BACK,
): ExportManifestCompatibility {
  if (manifest.schemaVersion > currentSchemaVersion) {
    return {
      compatible: false,
      reason: `export was made from schemaVersion ${manifest.schemaVersion}, newer than this build's ${currentSchemaVersion}`,
    };
  }
  const oldestSupported = minSupportedSchemaVersion(currentSchemaVersion, versionsBack);
  if (manifest.schemaVersion < oldestSupported) {
    return {
      compatible: false,
      reason: `export was made from schemaVersion ${manifest.schemaVersion}, older than the oldest this build still imports (${oldestSupported})`,
    };
  }
  return { compatible: true };
}
