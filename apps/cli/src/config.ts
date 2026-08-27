import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * `prefab login` persists here (apiUrl + a devLogin session cookie), so a
 * bootstrap-only session (site.create, token.create — both require a
 * signed-in human, not a per-site API token, ADR-0001) survives across CLI
 * invocations. Everyday CLI/MCP use is meant to run on PREFAB_TOKEN
 * instead; this is scaffolding for slice 1's lack of a signup UI.
 */
const CONFIG_DIR = path.join(homedir(), ".prefab");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export interface CliConfig {
  apiUrl?: string;
  cookie?: string;
}

export async function readConfig(): Promise<CliConfig> {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

export async function writeConfig(config: CliConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
