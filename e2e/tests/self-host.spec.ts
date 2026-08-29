import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { newUlid } from "@prefab/schema";
import { exportBundle } from "@prefab/commands";
import { authenticatedContext, newCheckoutDir } from "./helpers.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF_HOST_DIR = path.join(repoRoot, "apps", "self-host");
const SELF_HOST_SERVER_PATH = path.join(SELF_HOST_DIR, "src", "server.ts");
const SELF_HOST_PORT = 8790;

function formBlock(id: string) {
  return {
    id,
    type: "form",
    parent: null,
    order: 1000,
    schemaVersion: 1,
    props: {
      heading: "Contact us",
      fields: [
        { type: "text", label: "Name", name: "name", required: true, options: "" },
        { type: "email", label: "Email", name: "email", required: true, options: "" },
      ],
      submitLabel: "Submit",
      successMessage: "Thanks — we'll be in touch.",
      turnstileEnabled: false,
    },
    responsive: {},
  };
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`${url} never became healthy within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once("exit", finish);
    child.kill("SIGTERM");
    // A stubborn process would otherwise leak past this test and squat on
    // SELF_HOST_PORT for whatever runs next in the suite (observed: the
    // very failure this guards against) — SIGKILL is unconditional, so
    // this never leaves a zombie behind the way a signal-forwarding
    // wrapper process (e.g. npx, which this spawns via node directly
    // instead of) might.
    setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, 2_000);
    setTimeout(finish, 4_000);
  });
}

// SLICES.md Slice 7 demo / R10: "An exported self-host runtime serves the
// site and accepts a form submission with all pre-fab infrastructure
// unreachable." The self-host process below is started with none of
// apps/api's env vars (no DATABASE_URL, no PREFAB_API_URL) — its own code
// never references either, so this is a structural guarantee, not a race
// against the rest of the suite's API server happening to be reachable.
test("an exported self-host runtime serves the site and accepts a form submission with no pre-fab infrastructure reachable (R10)", async () => {
  test.setTimeout(120_000);

  const { ctx, site } = await authenticatedContext("selfhost");
  const formId = newUlid();
  await ctx.api.writePage(site.site.id, site.page.id, {
    title: site.page.title,
    slug: site.page.slug,
    blocks: [formBlock(formId)],
    expectedVersion: site.page.version,
  });

  const outDir = await newCheckoutDir();
  const bundleStoreDir = await mkdtemp(path.join(tmpdir(), "pf-e2e-selfhost-bundlestore-"));
  const dataDir = await mkdtemp(path.join(tmpdir(), "pf-e2e-selfhost-data-"));

  await exportBundle.run(ctx, {
    siteId: site.site.id,
    outDir,
    bundleStoreDir,
    runtimeApiUrl: `http://localhost:${SELF_HOST_PORT}`,
  });

  // Spawns node directly with `--import tsx`, the same shape build-worker.ts
  // uses for its own subprocess — never through an `npx`/`pnpm` wrapper,
  // whose own child process a kill signal doesn't reliably reach (observed:
  // a killed wrapper leaving its real tsx process alive, squatting on
  // SELF_HOST_PORT for whatever test ran next).
  const child = spawn(process.execPath, ["--import", "tsx", SELF_HOST_SERVER_PATH], {
    cwd: SELF_HOST_DIR,
    env: { ...process.env, PORT: String(SELF_HOST_PORT), BUNDLE_DIR: outDir, DATA_DIR: dataDir },
    stdio: "pipe",
  });

  try {
    await waitForHealth(`http://localhost:${SELF_HOST_PORT}/health`, 20_000);

    const page = await fetch(`http://localhost:${SELF_HOST_PORT}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Contact us");

    const submit = await fetch(`http://localhost:${SELF_HOST_PORT}/v1/runtime/forms/${formId}/submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values: { name: "Ada Lovelace", email: "ada@example.com" } }),
    });
    expect(submit.status).toBe(201);
    const body = (await submit.json()) as { id: string };
    expect(body.id).toBeTruthy();
  } finally {
    await stopChild(child);
    await rm(outDir, { recursive: true, force: true });
    await rm(bundleStoreDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});
