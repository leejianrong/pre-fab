import { describe, expect, it } from "vitest";
import { submitForm } from "../src/submit.js";
import { createInMemoryRateLimiter } from "../src/rate-limit.js";
import type { FormManifest } from "../src/types.js";
import type { CreatedSubmission, FormSettings, SubmissionStore, SubmitFormDeps } from "../src/submit.js";

const FORM: FormManifest = {
  id: "form1",
  siteId: "site1",
  heading: "Contact",
  fields: [{ type: "email", label: "Email", name: "email", required: true }],
  submitLabel: "Submit",
  turnstileEnabled: false,
};

function makeDeps(overrides: Partial<SubmitFormDeps> = {}, settings: FormSettings | null = null): { deps: SubmitFormDeps; stored: CreatedSubmission[]; notifyCalls: number; webhookCalls: number; notifyStatuses: Array<{ id: string; status: string }> } {
  const stored: CreatedSubmission[] = [];
  const notifyStatuses: Array<{ id: string; status: string }> = [];
  let notifyCalls = 0;
  let webhookCalls = 0;

  const submissions: SubmissionStore = {
    async create(input) {
      const created = { id: input.id, createdAt: "2026-01-01T00:00:00Z" };
      stored.push(created);
      return created;
    },
    async setNotifyStatus(id, _siteId, status) {
      notifyStatuses.push({ id, status });
    },
  };

  const deps: SubmitFormDeps = {
    forms: { async getForm(formId) { return formId === FORM.id ? FORM : null; } },
    formSettings: { async getSettings() { return settings; } },
    submissions,
    rateLimiter: createInMemoryRateLimiter({ limit: 100, windowMs: 60_000 }),
    turnstile: { async verify() { return { success: true }; } },
    notifier: { async notify() { notifyCalls++; } },
    webhooks: { async enqueue() { webhookCalls++; } },
    ...overrides,
  };

  return { deps, stored, get notifyCalls() { return notifyCalls; }, get webhookCalls() { return webhookCalls; }, notifyStatuses };
}

describe("submitForm", () => {
  it("stores a valid submission and returns its id", async () => {
    const { deps, stored } = makeDeps();
    const result = await submitForm({ id: "sub1", formId: FORM.id, values: { email: "a@example.com" }, ip: "203.0.113.1" }, deps);
    expect(result).toEqual({ status: "created", submissionId: "sub1" });
    expect(stored).toHaveLength(1);
  });

  it("returns not_found for an unknown form", async () => {
    const { deps } = makeDeps();
    const result = await submitForm({ id: "sub1", formId: "nope", values: {}, ip: null }, deps);
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns invalid with issues for a bad submission, storing nothing", async () => {
    const { deps, stored } = makeDeps();
    const result = await submitForm({ id: "sub1", formId: FORM.id, values: {}, ip: null }, deps);
    expect(result.status).toBe("invalid");
    expect(stored).toHaveLength(0);
  });

  it("enforces per-IP rate limiting", async () => {
    const { deps } = makeDeps({ rateLimiter: createInMemoryRateLimiter({ limit: 1, windowMs: 60_000 }) });
    const first = await submitForm({ id: "sub1", formId: FORM.id, values: { email: "a@example.com" }, ip: "203.0.113.1" }, deps);
    expect(first.status).toBe("created");
    const second = await submitForm({ id: "sub2", formId: FORM.id, values: { email: "a@example.com" }, ip: "203.0.113.1" }, deps);
    expect(second.status).toBe("rate_limited");
  });

  it("requires a Turnstile token and verification when the form has Turnstile enabled", async () => {
    const turnstileForm = { ...FORM, turnstileEnabled: true };
    const { deps: baseDeps } = makeDeps();
    const deps: typeof baseDeps = { ...baseDeps, forms: { async getForm() { return turnstileForm; } } };

    const missingToken = await submitForm({ id: "sub1", formId: FORM.id, values: { email: "a@example.com" }, ip: null }, deps);
    expect(missingToken.status).toBe("turnstile_failed");

    const failingDeps = { ...deps, turnstile: { async verify() { return { success: false }; } } };
    const failed = await submitForm({ id: "sub2", formId: FORM.id, values: { email: "a@example.com" }, ip: null, turnstileToken: "t" }, failingDeps);
    expect(failed.status).toBe("turnstile_failed");

    const passed = await submitForm({ id: "sub3", formId: FORM.id, values: { email: "a@example.com" }, ip: null, turnstileToken: "t" }, deps);
    expect(passed.status).toBe("created");
  });

  it("still stores the submission when the notifier throws, and records the failure (R7.4)", async () => {
    const { deps, stored, notifyStatuses } = makeDeps(
      { notifier: { async notify() { throw new Error("email provider unavailable"); } } },
      { notifyEmail: "owner@example.com", webhookUrl: null, webhookSecret: null },
    );
    const result = await submitForm({ id: "sub1", formId: FORM.id, values: { email: "a@example.com" }, ip: null }, deps);
    expect(result.status).toBe("created");
    expect(stored).toHaveLength(1);
    expect(notifyStatuses).toEqual([{ id: "sub1", status: "failed" }]);
  });

  it("skips notification and webhook dispatch when no settings are configured", async () => {
    const helper = makeDeps();
    await submitForm({ id: "sub1", formId: FORM.id, values: { email: "a@example.com" }, ip: null }, helper.deps);
    expect(helper.notifyCalls).toBe(0);
    expect(helper.webhookCalls).toBe(0);
  });

  it("notifies and enqueues a webhook when both are configured", async () => {
    const helper = makeDeps(undefined, {
      notifyEmail: "owner@example.com",
      webhookUrl: "https://example.com/hook",
      webhookSecret: null,
    });
    await submitForm({ id: "sub1", formId: FORM.id, values: { email: "a@example.com" }, ip: null }, helper.deps);
    expect(helper.notifyCalls).toBe(1);
    expect(helper.webhookCalls).toBe(1);
  });
});
