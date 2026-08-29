import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSelfHostDb, type SelfHostDb } from "../src/db.js";
import { createSqliteFormManifestStore, createSqliteFormSettingsStore, createSqliteSubmissionStore } from "../src/runtime-adapters.js";

let dir: string;
let db: SelfHostDb;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pf-selfhost-db-"));
  db = openSelfHostDb(path.join(dir, "test.db"));
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("SQLite-backed @prefab/runtime storage interfaces (ADR-0010 tier b)", () => {
  it("FormManifestStore returns null for an unknown form, and the seeded shape for a known one", async () => {
    db.prepare(
      "INSERT INTO forms (id, site_id, heading, fields, submit_label, turnstile_enabled) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("form-1", "site-1", "Contact us", JSON.stringify([{ type: "text", label: "Name", name: "name", required: true, options: "" }]), "Submit", 0);

    const store = createSqliteFormManifestStore(db);
    expect(await store.getForm("unknown")).toBeNull();
    const form = await store.getForm("form-1");
    expect(form).toMatchObject({
      id: "form-1",
      siteId: "site-1",
      heading: "Contact us",
      submitLabel: "Submit",
      turnstileEnabled: false,
    });
    expect(form?.fields).toHaveLength(1);
  });

  it("FormSettingsStore returns all-null settings for a form with no row yet, and the real row once configured", async () => {
    db.prepare("INSERT INTO forms (id, site_id) VALUES (?, ?)").run("form-1", "site-1");
    const store = createSqliteFormSettingsStore(db);
    expect(await store.getSettings("form-1", "site-1")).toEqual({ notifyEmail: null, webhookUrl: null, webhookSecret: null });

    db.prepare("INSERT INTO form_settings (form_id, site_id, notify_email, webhook_url, webhook_secret) VALUES (?, ?, ?, ?, ?)").run(
      "form-1",
      "site-1",
      "owner@example.com",
      "https://example.com/hook",
      "shh",
    );
    expect(await store.getSettings("form-1", "site-1")).toEqual({
      notifyEmail: "owner@example.com",
      webhookUrl: "https://example.com/hook",
      webhookSecret: "shh",
    });
  });

  it("SubmissionStore creates a row and later updates its notify status", async () => {
    db.prepare("INSERT INTO forms (id, site_id) VALUES (?, ?)").run("form-1", "site-1");
    const store = createSqliteSubmissionStore(db);
    const created = await store.create({ id: "sub-1", formId: "form-1", siteId: "site-1", values: { name: "Ada" }, ip: "127.0.0.1" });
    expect(created.id).toBe("sub-1");
    expect(() => new Date(created.createdAt)).not.toThrow();

    const row = db.prepare("SELECT notify_status, notify_error FROM submissions WHERE id = ?").get("sub-1");
    expect(row).toMatchObject({ notify_status: "skipped", notify_error: null });

    await store.setNotifyStatus("sub-1", "site-1", "failed", "provider down");
    const updated = db.prepare("SELECT notify_status, notify_error FROM submissions WHERE id = ?").get("sub-1");
    expect(updated).toMatchObject({ notify_status: "failed", notify_error: "provider down" });
  });
});
