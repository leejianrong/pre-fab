import { describe, expect, it } from "vitest";
import {
  buildExportManifest,
  checkExportManifestCompatible,
  EXPORT_MANIFEST_FORMAT,
  minSupportedSchemaVersion,
} from "../src/export-manifest.js";

describe("export manifest generation (Slice 7, tier a)", () => {
  it("builds a manifest declaring the current schemaVersion and a two-versions-back floor", () => {
    const manifest = buildExportManifest({ schemaVersion: 5 });
    expect(manifest).toMatchObject({ format: EXPORT_MANIFEST_FORMAT, schemaVersion: 5, minSupportedSchemaVersion: 3 });
    expect(() => new Date(manifest.generatedAt)).not.toThrow();
  });

  it("floors minSupportedSchemaVersion at 0 rather than going negative", () => {
    expect(minSupportedSchemaVersion(1)).toBe(0);
    expect(minSupportedSchemaVersion(0)).toBe(0);
  });
});

describe("export manifest version-range logic (Slice 7 unit test: 'version-range logic')", () => {
  it("accepts an export from the current schemaVersion", () => {
    expect(checkExportManifestCompatible({ schemaVersion: 5 }, 5)).toEqual({ compatible: true });
  });

  it("accepts an export from exactly two versions behind current", () => {
    const result = checkExportManifestCompatible({ schemaVersion: 1 }, 3);
    expect(result.compatible).toBe(true);
  });

  it("rejects an export more than two versions behind current", () => {
    const result = checkExportManifestCompatible({ schemaVersion: 0 }, 3);
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/older than the oldest/);
  });

  it("rejects an export from a schemaVersion newer than this build understands", () => {
    const result = checkExportManifestCompatible({ schemaVersion: 4 }, 3);
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/newer than this build/);
  });

  it("honours a custom versionsBack window", () => {
    expect(checkExportManifestCompatible({ schemaVersion: 1 }, 5, 4).compatible).toBe(true);
    expect(checkExportManifestCompatible({ schemaVersion: 1 }, 5, 3).compatible).toBe(false);
  });
});
