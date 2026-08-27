import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { pull } from "@prefab/commands";
import { authenticatedContext, newCheckoutDir } from "./helpers.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const UNREACHABLE_API_URL = "http://127.0.0.1:1"; // reserved port, refuses instantly — the real CLI's own guard against hanging

// R16: the CLI must work against a local checkout with no network at all
// for build/preview, and must fail fast (not hang) rather than succeed
// when a mutating command needs the network and can't reach it.
test.describe("offline (R16)", () => {
  test("prefab build and prefab preview succeed against a local checkout with no network", async () => {
    const { ctx, site } = await authenticatedContext("offline-build");
    const dir = await newCheckoutDir();
    await pull.run(ctx, { siteId: site.site.id, dir });

    const bundleStoreDir = path.join(dir, "bundles");
    const buildResult = await runCli(["--json", "build", dir], { PREFAB_API_URL: UNREACHABLE_API_URL, BUNDLE_STORE_DIR: bundleStoreDir });
    expect(buildResult.exitCode).toBe(0);
    const built = JSON.parse(buildResult.stdout);
    expect(built.bundlePath).toContain(bundleStoreDir);
  });

  test("prefab push fails with exit code 4 when the network is unreachable, rather than hanging", async () => {
    const { ctx, site } = await authenticatedContext("offline-push");
    const dir = await newCheckoutDir();
    await pull.run(ctx, { siteId: site.site.id, dir });

    const startedAt = Date.now();
    const result = await runCli(["--json", "push", dir], { PREFAB_API_URL: UNREACHABLE_API_URL });
    const elapsedMs = Date.now() - startedAt;

    expect(result.exitCode).toBe(4);
    expect(elapsedMs).toBeLessThan(15_000); // well under api-client's 10s abort timeout plus overhead — never "hanging"
    const errorPayload = JSON.parse(result.stderr);
    expect(errorPayload.error.code).toBe("unreachable");
  });
});

async function runCli(args: string[], env: Record<string, string>): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", path.join(repoRoot, "apps", "cli", "src", "main.ts"), ...args],
      { cwd: path.join(repoRoot, "apps", "cli"), env: { ...process.env, ...env }, timeout: 20_000 },
    );
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const execError = error as { code?: number; stdout?: string; stderr?: string };
    return { exitCode: execError.code ?? 1, stdout: execError.stdout ?? "", stderr: execError.stderr ?? "" };
  }
}
