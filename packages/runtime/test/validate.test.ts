import { describe, expect, it } from "vitest";
import { validateSubmissionValues } from "../src/validate.js";
import type { FormFieldDef } from "../src/types.js";

const FIELDS: FormFieldDef[] = [
  { type: "text", label: "Name", name: "name", required: true },
  { type: "email", label: "Email", name: "email", required: true },
  { type: "textarea", label: "Message", name: "message", required: false },
  { type: "select", label: "Topic", name: "topic", required: false, options: "sales\nsupport" },
  { type: "checkbox", label: "Subscribe", name: "subscribe", required: false },
  { type: "file", label: "Attachment", name: "attachment", required: false },
];

describe("validateSubmissionValues", () => {
  it("accepts a fully valid submission", () => {
    const result = validateSubmissionValues(FIELDS, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      message: "Hello",
      topic: "sales",
      subscribe: "on",
      attachment: "",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.name).toBe("Ada Lovelace");
      expect(result.values.subscribe).toBe(true);
    }
  });

  it("rejects a missing required field, naming it", () => {
    const result = validateSubmissionValues(FIELDS, { email: "ada@example.com" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({ field: "name", message: "Name is required" });
    }
  });

  it("rejects an invalid email", () => {
    const result = validateSubmissionValues(FIELDS, { name: "Ada", email: "not-an-email" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.field === "email")).toBe(true);
    }
  });

  it("rejects a select value outside the offered options", () => {
    const result = validateSubmissionValues(FIELDS, { name: "Ada", email: "ada@example.com", topic: "billing" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.field === "topic")).toBe(true);
    }
  });

  it("treats an absent checkbox as false, not an error", () => {
    const result = validateSubmissionValues(FIELDS, { name: "Ada", email: "ada@example.com" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.values.subscribe).toBe(false);
  });

  it("drops keys not declared as fields", () => {
    const result = validateSubmissionValues(FIELDS, { name: "Ada", email: "ada@example.com", __proto__: "junk", extra: "nope" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.values).sort()).toEqual(["attachment", "email", "message", "name", "subscribe", "topic"]);
  });

  it("rejects an over-long text field", () => {
    const result = validateSubmissionValues(FIELDS, { name: "a".repeat(3000), email: "ada@example.com" });
    expect(result.ok).toBe(false);
  });
});
