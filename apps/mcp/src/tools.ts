import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClientError, ApiUnreachableError } from "@prefab/api-client";
import { commandRegistry, commandErrorFromApiCode, CommandError, type CommandContext } from "@prefab/commands";
import { schemas, type SchemaCommandName } from "./schemas.js";

/**
 * Same mapping the CLI applies for R13's exit codes — an agent gets the
 * identical structured `code`, never elevated trust or a different error
 * shape than a human's CLI session would see for the same mistake
 * (ADR-0001).
 */
function toErrorPayload(error: unknown): { code: string; message: string; details?: unknown } {
  if (error instanceof CommandError) return { code: error.code, message: error.message, details: error.details };
  if (error instanceof ApiClientError) {
    const mapped = commandErrorFromApiCode(error.code, error.status, error.message, error.details);
    return { code: mapped.code, message: mapped.message, details: mapped.details };
  }
  if (error instanceof ApiUnreachableError) return { code: "unreachable", message: error.message };
  return { code: "internal", message: error instanceof Error ? error.message : String(error) };
}

function mcpToolName(commandName: string): string {
  return commandName.replace(/\./g, "_");
}

/**
 * Registers one MCP tool per command in the shared registry — mechanically,
 * not by hand-picking a subset. This is the concrete form of "MCP is a
 * thin adapter over the CLI's command layer" (ADR-0003): every tool here
 * calls the exact same `command.run()` the CLI calls, so drift is
 * structural to prevent, not just tested for.
 */
export function registerTools(server: McpServer, ctx: CommandContext): void {
  const openPreviewServers = new Set<() => Promise<void>>();
  const closeAllPreviews = () => Promise.all([...openPreviewServers].map((close) => close()));
  process.on("SIGINT", () => void closeAllPreviews().then(() => process.exit(0)));
  process.on("SIGTERM", () => void closeAllPreviews().then(() => process.exit(0)));

  for (const command of commandRegistry) {
    const schema = schemas[command.name as SchemaCommandName];
    if (!schema) {
      throw new Error(`apps/mcp has no input schema for command "${command.name}" — see schemas.ts`);
    }

    server.registerTool(
      mcpToolName(command.name),
      { description: command.description, inputSchema: schema },
      async (args: Record<string, unknown>) => {
        try {
          const result = await command.run(ctx, args as never);

          // A preview server is meant to keep serving after this call
          // returns — R15's "stable preview URL" — so it is tracked for a
          // clean shutdown rather than closed immediately.
          if (command.name === "preview" && result && typeof result === "object" && "close" in result) {
            const { close, ...rest } = result as { close: () => Promise<void> } & Record<string, unknown>;
            openPreviewServers.add(close);
            return { content: [{ type: "text" as const, text: JSON.stringify(rest) }] };
          }

          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify({ error: toErrorPayload(error) }) }],
          };
        }
      },
    );
  }
}
