import { describe, expect, it } from "vitest";
import { ApiClientError, ApiUnreachableError } from "@prefab/api-client";
import { runCommand } from "../src/output.js";

function captureStd(): { out: string[]; err: string[]; restore: () => void } {
  const out: string[] = [];
  const err: string[] = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string) => {
    out.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    err.push(chunk);
    return true;
  }) as typeof process.stderr.write;
  return {
    out,
    err,
    restore: () => {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    },
  };
}

describe("runCommand — R13's exit-code contract", () => {
  it("exits 0 and prints JSON on success with --json", async () => {
    const capture = captureStd();
    try {
      await runCommand({ json: true }, async () => ({ ok: true }));
      expect(process.exitCode).toBe(0);
      expect(capture.out.join("")).toContain('"ok": true');
    } finally {
      capture.restore();
      process.exitCode = undefined;
    }
  });

  it("maps a conflict ApiClientError to exit code 2", async () => {
    const capture = captureStd();
    try {
      await runCommand({ json: true }, async () => {
        throw new ApiClientError("conflict", 409, "stale version");
      });
      expect(process.exitCode).toBe(2);
      expect(capture.err.join("")).toContain('"code": "conflict"');
    } finally {
      capture.restore();
      process.exitCode = undefined;
    }
  });

  it("maps unauthorized/forbidden to exit code 3", async () => {
    const capture = captureStd();
    try {
      await runCommand({ json: true }, async () => {
        throw new ApiClientError("unauthorized", 401, "bad token");
      });
      expect(process.exitCode).toBe(3);
    } finally {
      capture.restore();
      process.exitCode = undefined;
    }
  });

  it("maps an unreachable API to exit code 4, never hanging", async () => {
    const capture = captureStd();
    try {
      await runCommand({ json: true }, async () => {
        throw new ApiUnreachableError(new Error("fetch failed"));
      });
      expect(process.exitCode).toBe(4);
    } finally {
      capture.restore();
      process.exitCode = undefined;
    }
  });

  it("maps validation_error to exit code 1", async () => {
    const capture = captureStd();
    try {
      await runCommand({ json: true }, async () => {
        throw new ApiClientError("validation_error", 400, "bad input", [{ blockId: "x", path: ["props"], message: "nope" }]);
      });
      expect(process.exitCode).toBe(1);
      expect(capture.err.join("")).toContain("blockId");
    } finally {
      capture.restore();
      process.exitCode = undefined;
    }
  });
});

describe("runCommand — human-mode `message` narration (KAN-1268)", () => {
  it("prints a result's top-level `message` field alone, instead of dumping raw JSON", async () => {
    const capture = captureStd();
    try {
      await runCommand({ json: false }, async () => ({
        message: "Subscription canceled. Your data and export access are guaranteed until October 13, 2026 — run `prefab export` anytime before then.",
        retentionEndsAt: "2026-10-13T00:00:00.000Z",
        status: "canceled",
      }));
      expect(process.exitCode).toBe(0);
      expect(capture.out.join("")).toBe(
        "Subscription canceled. Your data and export access are guaranteed until October 13, 2026 — run `prefab export` anytime before then.\n",
      );
    } finally {
      capture.restore();
      process.exitCode = undefined;
    }
  });

  it("still dumps raw JSON in human mode when a result has no `message` field", async () => {
    const capture = captureStd();
    try {
      await runCommand({ json: false }, async () => ({ ok: true }));
      expect(process.exitCode).toBe(0);
      expect(capture.out.join("")).toContain('"ok": true');
    } finally {
      capture.restore();
      process.exitCode = undefined;
    }
  });

  it("--json mode is untouched by `message` — the full object prints as-is, message included", async () => {
    const capture = captureStd();
    try {
      await runCommand({ json: true }, async () => ({ message: "hi", retentionEndsAt: "2026-10-13T00:00:00.000Z" }));
      expect(process.exitCode).toBe(0);
      expect(JSON.parse(capture.out.join(""))).toEqual({ message: "hi", retentionEndsAt: "2026-10-13T00:00:00.000Z" });
    } finally {
      capture.restore();
      process.exitCode = undefined;
    }
  });
});
