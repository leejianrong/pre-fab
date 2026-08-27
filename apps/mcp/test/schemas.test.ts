import { describe, expect, it } from "vitest";
import { commandRegistry } from "@prefab/commands";
import { schemas } from "../src/schemas.js";

describe("MCP tool schemas cover the full command registry", () => {
  it("has an input schema for every command — no tool silently missing (ADR-0003)", () => {
    const missing = commandRegistry.filter((command) => !(command.name in schemas)).map((c) => c.name);
    expect(missing).toEqual([]);
  });

  it("has no orphaned schema for a command that no longer exists", () => {
    const registryNames = new Set(commandRegistry.map((c) => c.name));
    const orphaned = Object.keys(schemas).filter((name) => !registryNames.has(name));
    expect(orphaned).toEqual([]);
  });
});
