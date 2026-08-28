import { describe, expect, it } from "vitest";
import { toCsv } from "../src/csv.js";

describe("toCsv", () => {
  it("renders a simple header and rows", () => {
    const csv = toCsv(["name", "email"], [{ name: "Ada", email: "ada@example.com" }]);
    expect(csv).toBe("name,email\r\nAda,ada@example.com\r\n");
  });

  it("quotes a field containing the delimiter", () => {
    const csv = toCsv(["name"], [{ name: "Lovelace, Ada" }]);
    expect(csv).toContain('"Lovelace, Ada"');
  });

  it("quotes and doubles embedded quotes", () => {
    const csv = toCsv(["message"], [{ message: 'She said "hello"' }]);
    expect(csv).toContain('"She said ""hello"""');
  });

  it("quotes a field containing a newline", () => {
    const csv = toCsv(["message"], [{ message: "line one\nline two" }]);
    expect(csv).toContain('"line one\nline two"');
  });

  it("fills a missing column with an empty string", () => {
    const csv = toCsv(["name", "topic"], [{ name: "Ada" }]);
    expect(csv).toBe("name,topic\r\nAda,\r\n");
  });
});
