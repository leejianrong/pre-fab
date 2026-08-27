import { ApiClientError, ApiUnreachableError } from "@prefab/api-client";
import { CommandError, commandErrorFromApiCode } from "@prefab/commands";

export interface GlobalOptions {
  json?: boolean;
}

/**
 * R13's contract, in one place so every subcommand gets it identically:
 * --json on every command, machine-readable errors on stderr with a
 * stable `code`, and exit codes 0 ok / 1 user error / 2 conflict / 3 auth /
 * 4 upstream.
 */
export async function runCommand<T>(options: GlobalOptions, fn: () => Promise<T>): Promise<void> {
  try {
    const result = await fn();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      printHuman(result);
    }
    process.exitCode = 0;
  } catch (error) {
    const commandError = toCommandError(error);
    if (options.json) {
      process.stderr.write(
        `${JSON.stringify({ error: { code: commandError.code, message: commandError.message, details: commandError.details } }, null, 2)}\n`,
      );
    } else {
      process.stderr.write(`error: ${commandError.message}\n`);
    }
    process.exitCode = commandError.exitCode;
  }
}

function toCommandError(error: unknown): CommandError {
  if (error instanceof CommandError) return error;
  if (error instanceof ApiClientError) {
    return commandErrorFromApiCode(error.code, error.status, error.message, error.details);
  }
  if (error instanceof ApiUnreachableError) {
    return new CommandError("upstream", "unreachable", error.message);
  }
  return new CommandError("user_error", "internal", error instanceof Error ? error.message : String(error));
}

function printHuman(result: unknown): void {
  if (result === undefined) return;
  if (typeof result === "object" && result !== null) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${String(result)}\n`);
}
