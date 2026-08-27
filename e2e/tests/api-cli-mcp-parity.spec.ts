import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ApiClient } from "@prefab/api-client";
import { SEED_EMAIL } from "../global-setup.js";
import { API_URL } from "./helpers.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const HEADING = "Byte-identical across every surface";

async function freshSiteAndToken(slugPrefix: string) {
  const bootstrap = new ApiClient({ baseUrl: API_URL });
  await bootstrap.devLogin(SEED_EMAIL);
  const site = await bootstrap.createSite({ slug: `${slugPrefix}-${Date.now()}`, name: slugPrefix });
  const token = await bootstrap.createToken(site.site.id, { name: "e2e-parity" });
  return { site, token: token.token };
}

function normalize(document: { title: string; slug: string; blocks: Array<{ type: string; schemaVersion: number; props: unknown }> }) {
  return {
    title: document.title,
    slug: document.slug,
    blocks: document.blocks.map((b) => ({ type: b.type, schemaVersion: b.schemaVersion, props: b.props })),
  };
}

// R12 / ADR-0003's core promise, checked directly: the exact same mutation,
// carried out over the HTTP API, the CLI and MCP, must produce the same
// document shape — not "should", since all three are clients of one write
// path, never three implementations.
test("the same mutation performed via API, CLI and MCP produces byte-identical documents", async ({ request }) => {
  const [viaApi, viaCli, viaMcp] = await Promise.all([
    freshSiteAndToken("parity-api"),
    freshSiteAndToken("parity-cli"),
    freshSiteAndToken("parity-mcp"),
  ]);

  const pageId = (site: Awaited<ReturnType<typeof freshSiteAndToken>>["site"]) => site.page.id;

  // 1. Direct HTTP API call.
  const apiResponse = await request.put(`${API_URL}/v1/sites/${viaApi.site.site.id}/pages/${pageId(viaApi.site)}`, {
    headers: { authorization: `Bearer ${viaApi.token}` },
    data: {
      title: viaApi.site.page.title,
      slug: viaApi.site.page.slug,
      blocks: [{ ...viaApi.site.page.blocks[0], props: { ...viaApi.site.page.blocks[0]!.props, heading: HEADING } }],
      expectedVersion: viaApi.site.page.version,
    },
  });
  expect(apiResponse.ok()).toBe(true);

  // 2. The real CLI, as a subprocess.
  const cliArgs = [
    "--import",
    "tsx",
    path.join(repoRoot, "apps", "cli", "src", "main.ts"),
    "--json",
    "page",
    "write",
    viaCli.site.site.id,
    pageId(viaCli.site),
    viaCli.site.page.title,
    viaCli.site.page.slug,
    JSON.stringify([{ ...viaCli.site.page.blocks[0], props: { ...viaCli.site.page.blocks[0]!.props, heading: HEADING } }]),
    String(viaCli.site.page.version),
  ];
  const cliResult = await execFileAsync(process.execPath, cliArgs, {
    cwd: path.join(repoRoot, "apps", "cli"),
    env: { ...process.env, PREFAB_API_URL: API_URL, PREFAB_TOKEN: viaCli.token },
  });
  expect(JSON.parse(cliResult.stdout).title).toBe(viaCli.site.page.title);

  // 3. The real MCP server, over stdio, via the MCP SDK's own client.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", path.join(repoRoot, "apps", "mcp", "src", "main.ts")],
    cwd: path.join(repoRoot, "apps", "mcp"),
    env: { ...(process.env as Record<string, string>), PREFAB_API_URL: API_URL, PREFAB_TOKEN: viaMcp.token },
  });
  const mcpClient = new Client({ name: "e2e-parity", version: "0.0.0" });
  await mcpClient.connect(transport);
  const mcpResult = await mcpClient.callTool({
    name: "page_write",
    arguments: {
      siteId: viaMcp.site.site.id,
      pageId: pageId(viaMcp.site),
      title: viaMcp.site.page.title,
      slug: viaMcp.site.page.slug,
      blocks: [{ ...viaMcp.site.page.blocks[0], props: { ...viaMcp.site.page.blocks[0]!.props, heading: HEADING } }],
      expectedVersion: viaMcp.site.page.version,
    },
  });
  expect(mcpResult.isError).toBeFalsy();
  await mcpClient.close();

  // Compare what actually landed, fetched back independently for all three.
  const [apiDoc, cliDoc, mcpDoc] = await Promise.all(
    [viaApi, viaCli, viaMcp].map(async ({ site, token }) => {
      const response = await request.get(`${API_URL}/v1/sites/${site.site.id}/pages/${pageId(site)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      return response.json();
    }),
  );

  expect(normalize(cliDoc)).toEqual(normalize(apiDoc));
  expect(normalize(mcpDoc)).toEqual(normalize(apiDoc));
});
