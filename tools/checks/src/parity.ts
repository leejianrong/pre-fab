import { readFileSync } from "node:fs";

export interface ApiMutation {
  name: string;
}

export interface RegistryCommand {
  name: string;
  mutation?: string;
}

/**
 * R12 / ADR-0003: "CI enumerates every API mutation and fails the build
 * unless each has a corresponding CLI command and MCP tool." apps/mcp
 * mechanically wraps every entry in the shared registry (proven by its own
 * test, apps/mcp/test/schemas.test.ts) — so once a mutation is covered
 * *here*, MCP coverage follows structurally, not by a second check.
 */
export function findUncoveredMutations(apiMutations: ApiMutation[], commands: RegistryCommand[]): string[] {
  const covered = new Set(commands.map((c) => c.mutation).filter((m): m is string => Boolean(m)));
  return apiMutations.map((m) => m.name).filter((name) => !covered.has(name));
}

/**
 * apps/cli wires each registry command by hand (flags differ per command,
 * unlike MCP's mechanical loop) — so unlike MCP, drift is possible: a
 * command added to the registry with no corresponding `program.command()`
 * in main.ts. Checked by identity, not by guessing a naming convention:
 * every export of @prefab/commands is compared against the registry by
 * object reference to find its real identifier, then that identifier is
 * checked for a match in main.ts's own source text.
 */
export function findCommandsMissingFromCli(
  commandRegistry: RegistryCommand[],
  commandsModule: Record<string, unknown>,
  cliMainSourcePath: string,
): string[] {
  const cliSource = readFileSync(cliMainSourcePath, "utf8");
  const missing: string[] = [];

  for (const command of commandRegistry) {
    const identifier = Object.entries(commandsModule).find(([, value]) => value === command)?.[0];
    if (!identifier) {
      missing.push(`${command.name} (no exported identifier found in @prefab/commands)`);
      continue;
    }
    const wordBoundary = new RegExp(`\\b${identifier}\\b`);
    if (!wordBoundary.test(cliSource)) {
      missing.push(`${command.name} (exported as ${identifier}, not referenced in ${cliMainSourcePath})`);
    }
  }

  return missing;
}
