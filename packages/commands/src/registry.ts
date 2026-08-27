import type { MutationName } from "@prefab/api/mutations";
import type { CommandContext } from "./context.js";

/**
 * The shared command layer ADR-0003 requires: apps/cli and apps/mcp both
 * wrap this SAME registry, never reimplementing a command's logic
 * separately. `mutation`, when present, names the API_MUTATIONS entry this
 * command exercises — tools/checks' parity script checks every entry in
 * apps/api's manifest is covered by at least one command here (R12).
 */
export interface Command<Args, Result> {
  name: string;
  description: string;
  mutation?: MutationName;
  run(ctx: CommandContext, args: Args): Promise<Result>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = Command<any, any>;

export function defineRegistry(commands: AnyCommand[]): AnyCommand[] {
  const seen = new Set<string>();
  for (const command of commands) {
    if (seen.has(command.name)) throw new Error(`duplicate command name "${command.name}"`);
    seen.add(command.name);
  }
  return commands;
}
