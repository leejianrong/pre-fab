import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findCommandsMissingFromCli, findUncoveredMutations } from "../src/parity.js";

describe("findUncoveredMutations (R12)", () => {
  it("reports an API mutation with no command covering it", () => {
    const uncovered = findUncoveredMutations(
      [{ name: "site.create" }, { name: "page.write" }],
      [{ name: "site.create", mutation: "site.create" }],
    );
    expect(uncovered).toEqual(["page.write"]);
  });

  it("reports nothing once every mutation is covered", () => {
    const uncovered = findUncoveredMutations(
      [{ name: "site.create" }],
      [{ name: "site.create", mutation: "site.create" }],
    );
    expect(uncovered).toEqual([]);
  });

  it("ignores commands with no mutation field (reads, pull/push helpers)", () => {
    const uncovered = findUncoveredMutations(
      [{ name: "site.create" }],
      [{ name: "site.create", mutation: "site.create" }, { name: "site.list" }],
    );
    expect(uncovered).toEqual([]);
  });
});

describe("findCommandsMissingFromCli", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("reports a registry command whose identifier never appears in main.ts", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "pf-checks-"));
    const mainPath = path.join(tempDir, "main.ts");
    await writeFile(mainPath, `import { siteCreate } from "@prefab/commands";\nsiteCreate.run();\n`, "utf8");

    const siteCreateCmd = { name: "site.create" };
    const pageWriteCmd = { name: "page.write" };

    const missing = findCommandsMissingFromCli(
      [siteCreateCmd, pageWriteCmd],
      { siteCreate: siteCreateCmd, pageWrite: pageWriteCmd },
      mainPath,
    );

    expect(missing).toEqual(["page.write (exported as pageWrite, not referenced in " + mainPath + ")"]);
  });

  it("reports nothing when every command's identifier is referenced", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "pf-checks-"));
    const mainPath = path.join(tempDir, "main.ts");
    await writeFile(mainPath, `import { siteCreate, pageWrite } from "@prefab/commands";\n`, "utf8");

    const siteCreateCmd = { name: "site.create" };
    const pageWriteCmd = { name: "page.write" };

    const missing = findCommandsMissingFromCli(
      [siteCreateCmd, pageWriteCmd],
      { siteCreate: siteCreateCmd, pageWrite: pageWriteCmd },
      mainPath,
    );

    expect(missing).toEqual([]);
  });

  it("flags a command with no exported identifier at all", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "pf-checks-"));
    const mainPath = path.join(tempDir, "main.ts");
    await writeFile(mainPath, `// nothing here\n`, "utf8");

    const orphanCmd = { name: "orphan.thing" };
    const missing = findCommandsMissingFromCli([orphanCmd], { somethingElse: {} }, mainPath);

    expect(missing).toEqual(["orphan.thing (no exported identifier found in @prefab/commands)"]);
  });
});
