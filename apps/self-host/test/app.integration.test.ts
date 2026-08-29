import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { openSelfHostDb, type SelfHostDb } from "../src/db.js";
import { seedFormsFromBundle } from "../src/forms-seed.js";

let dir: string;
let bundleDir: string;
let db: SelfHostDb;
let app: FastifyInstance;
const FORM_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const SITE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";

async function seedBundle(): Promise<void> {
  bundleDir = path.join(dir, "bundle");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(path.join(bundleDir, "index.html"), "<!doctype html><title>Home</title><p>Hello from self-host</p>", "utf8");
  await writeFile(path.join(bundleDir, "app.js"), "console.log('island');", "utf8");
  await writeFile(
    path.join(bundleDir, "prefab-forms.json"),
    JSON.stringify([
      {
        id: FORM_ID,
        siteId: SITE_ID,
        heading: "Contact us",
        fields: [
          { type: "text", label: "Name", name: "name", required: true, options: "" },
          { type: "email", label: "Email", name: "email", required: true, options: "" },
        ],
        submitLabel: "Submit",
        turnstileEnabled: false,
      },
    ]),
    "utf8",
  );
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pf-selfhost-app-"));
  await seedBundle();
  db = openSelfHostDb(path.join(dir, "prefab.db"));
  await seedFormsFromBundle(db, bundleDir);
  app = buildApp({ bundleDir, db });
});

afterAll(async () => {
  await app.close();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("apps/self-host — serves the bundle and implements the runtime API (ADR-0010 tier b, R10)", () => {
  it("serves the exported static bundle with the right content-type", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Hello from self-host");
  });

  it("serves a .js file with a real JavaScript content-type, not application/octet-stream", async () => {
    const response = await app.inject({ method: "GET", url: "/app.js" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/javascript");
  });

  it("404s a path outside the bundle directory rather than traversing out of it", async () => {
    const response = await app.inject({ method: "GET", url: "/../../etc/passwd" });
    expect(response.statusCode).toBe(404);
  });

  it("accepts a valid form submission and persists it, with no pre-fab infrastructure involved at all", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/runtime/forms/${FORM_ID}/submissions`,
      payload: { values: { name: "Ada Lovelace", email: "ada@example.com" } },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.id).toBeTruthy();

    const row = db.prepare("SELECT values_json FROM submissions WHERE id = ?").get(body.id) as { values_json: string };
    expect(JSON.parse(row.values_json)).toEqual({ name: "Ada Lovelace", email: "ada@example.com" });
  });

  it("rejects an invalid submission (missing a required field) with 400, storing nothing", async () => {
    const before = db.prepare("SELECT COUNT(*) as n FROM submissions").get() as { n: number };
    const response = await app.inject({
      method: "POST",
      url: `/v1/runtime/forms/${FORM_ID}/submissions`,
      payload: { values: { name: "" } },
    });
    expect(response.statusCode).toBe(400);
    const after = db.prepare("SELECT COUNT(*) as n FROM submissions").get() as { n: number };
    expect(after.n).toBe(before.n);
  });

  it("404s a submission to an unknown form id", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/runtime/forms/01ARZ3NDEKTSV4RRFFQ69G5FZZ/submissions",
      payload: { values: {} },
    });
    expect(response.statusCode).toBe(404);
  });

  it("answers a CORS preflight for the submit endpoint", async () => {
    const response = await app.inject({ method: "OPTIONS", url: `/v1/runtime/forms/${FORM_ID}/submissions` });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
  });

  it("answers /health with no bundle or database involved", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });
});
