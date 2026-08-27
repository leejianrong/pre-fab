import type { Command } from "../registry.js";
import type { IssuedApiToken } from "@prefab/api-client";

export const tokenCreate: Command<{ siteId: string; name: string }, IssuedApiToken> = {
  name: "token.create",
  mutation: "token.create",
  description: "Mint a new per-site scoped, expiring, revocable API token for the CLI/MCP (ADR-0001)",
  run: (ctx, args) => ctx.api.createToken(args.siteId, { name: args.name }),
};
