import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_MUTATIONS } from "@prefab/api/mutations";
import * as commandsModule from "@prefab/commands";
import { findCommandsMissingFromCli, findUncoveredMutations } from "../parity.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const cliMainSourcePath = path.join(repoRoot, "apps", "cli", "src", "main.ts");

const uncoveredMutations = findUncoveredMutations([...API_MUTATIONS], commandsModule.commandRegistry);
const missingFromCli = findCommandsMissingFromCli(commandsModule.commandRegistry, commandsModule, cliMainSourcePath);

let failed = false;

if (uncoveredMutations.length > 0) {
  failed = true;
  console.error(`✗ R12 parity: ${uncoveredMutations.length} API mutation(s) with no command in @prefab/commands' registry`);
  for (const name of uncoveredMutations) console.error(`  ${name}`);
} else {
  console.log(`✓ R12 parity: all ${API_MUTATIONS.length} API mutations have a command (and therefore a CLI command and MCP tool)`);
}

if (missingFromCli.length > 0) {
  failed = true;
  console.error(`✗ CLI coverage: ${missingFromCli.length} registry command(s) not wired up in apps/cli/src/main.ts`);
  for (const entry of missingFromCli) console.error(`  ${entry}`);
} else {
  console.log(`✓ CLI coverage: every registry command is wired up in apps/cli/src/main.ts`);
}

process.exit(failed ? 1 : 0);
