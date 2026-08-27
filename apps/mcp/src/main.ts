#!/usr/bin/env -S node --import tsx
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "@prefab/commands";
import { registerTools } from "./tools.js";

const apiUrl = process.env.PREFAB_API_URL ?? "http://localhost:8787";
const token = process.env.PREFAB_TOKEN;
if (!token) {
  console.error("PREFAB_TOKEN is not set — the MCP server needs a per-site scoped API token (ADR-0001)");
  process.exit(1);
}

const ctx = createContext({ apiUrl, token });

const server = new McpServer({ name: "prefab", version: "0.0.0" });
registerTools(server, ctx);

const transport = new StdioServerTransport();
await server.connect(transport);
