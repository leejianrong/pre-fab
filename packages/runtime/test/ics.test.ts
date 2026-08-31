import { describe, expect, it } from "vitest";
import { escapeIcsText, foldIcsLine, formatIcsUtc, generateBookingIcs, validateIcs } from "../src/ics.js";

const BASE_EVENT = {
  uid: "booking-abc123@prefab.app",
  startsAtMs: Date.UTC(2026, 5, 15, 14, 0, 0),
  endsAtMs: Date.UTC(2026, 5, 15, 14, 30, 0),
  summary: "Booking with Ada Lovelace",
  organizerEmail: "owner@example.com",
  organizerName: "Site Owner",
  attendeeEmail: "ada@example.com",
  attendeeName: "Ada Lovelace",
  method: "REQUEST" as const,
  generatedAtMs: Date.UTC(2026, 5, 1, 0, 0, 0),
};

describe("formatIcsUtc", () => {
  it("formats as YYYYMMDDTHHMMSSZ", () => {
    expect(formatIcsUtc(Date.UTC(2026, 5, 15, 14, 30, 5))).toBe("20260615T143005Z");
  });
});

describe("escapeIcsText", () => {
  it("escapes backslash, semicolon, comma and newline in RFC 5545 order", () => {
    expect(escapeIcsText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });
});

describe("foldIcsLine", () => {
  it("leaves a short line untouched", () => {
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds a line over 75 octets with a CRLF and a leading space", () => {
    const long = "DESCRIPTION:" + "x".repeat(100);
    const folded = foldIcsLine(long);
    expect(folded).toContain("\r\n ");
    for (const physicalLine of folded.split("\r\n")) {
      expect(Buffer.byteLength(physicalLine, "utf8")).toBeLessThanOrEqual(75);
    }
    // Unfolding (strip CRLF + one leading space per continuation) recovers the original.
    const unfolded = folded.split("\r\n").map((l, i) => (i === 0 ? l : l.slice(1))).join("");
    expect(unfolded).toBe(long);
  });
});

describe("generateBookingIcs", () => {
  it("produces a structurally valid ICS document", () => {
    const ics = generateBookingIcs(BASE_EVENT);
    expect(validateIcs(ics)).toEqual({ valid: true, issues: [] });
  });

  it("uses CRLF line endings throughout", () => {
    const ics = generateBookingIcs(BASE_EVENT);
    expect(ics.includes("\r\n")).toBe(true);
    expect(ics.split("\n").every((line) => line === "" || line.endsWith("\r"))).toBe(true);
  });

  it("emits UTC DTSTART/DTEND matching the input instants", () => {
    const ics = generateBookingIcs(BASE_EVENT);
    expect(ics).toContain("DTSTART:20260615T140000Z");
    expect(ics).toContain("DTEND:20260615T143000Z");
  });

  it("escapes a comma/semicolon in the summary", () => {
    const ics = generateBookingIcs({ ...BASE_EVENT, summary: "Meeting, re: Q3 plan" });
    expect(ics).toContain("SUMMARY:Meeting\\, re\\: Q3 plan".replace("\\: ", ": ")); // colon isn't escaped, only structural delimiters
    expect(ics).toContain("SUMMARY:Meeting\\, re: Q3 plan");
    expect(validateIcs(ics).valid).toBe(true);
  });

  it("folds a very long description and still validates", () => {
    const ics = generateBookingIcs({ ...BASE_EVENT, description: "A".repeat(300) });
    expect(validateIcs(ics).valid).toBe(true);
    for (const physicalLine of ics.split("\r\n")) {
      expect(Buffer.byteLength(physicalLine, "utf8")).toBeLessThanOrEqual(75);
    }
  });

  it("marks a CANCEL method event as STATUS:CANCELLED", () => {
    const ics = generateBookingIcs({ ...BASE_EVENT, method: "CANCEL" });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(validateIcs(ics).valid).toBe(true);
  });

  it("bumps SEQUENCE for a rescheduled event, distinct from a fresh invite", () => {
    const rescheduled = generateBookingIcs({ ...BASE_EVENT, sequence: 1 });
    expect(rescheduled).toContain("SEQUENCE:1");
  });
});

describe("validateIcs", () => {
  it("flags a document missing required properties", () => {
    const result = validateIcs("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("BEGIN:VEVENT"))).toBe(true);
  });

  it("flags bare LF line endings", () => {
    const brokenIcs = generateBookingIcs(BASE_EVENT).replace(/\r\n/g, "\n");
    const result = validateIcs(brokenIcs);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("CRLF"))).toBe(true);
  });

  it("flags a non-UTC DTSTART", () => {
    const ics = generateBookingIcs(BASE_EVENT).replace("DTSTART:20260615T140000Z", "DTSTART:20260615T140000");
    const result = validateIcs(ics);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("DTSTART"))).toBe(true);
  });

  it("flags DTEND not after DTSTART", () => {
    const ics = generateBookingIcs({ ...BASE_EVENT, endsAtMs: BASE_EVENT.startsAtMs });
    const result = validateIcs(ics);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("DTEND must be after DTSTART"))).toBe(true);
  });

  it("flags an unfolded line over 75 octets", () => {
    const brokenIcs = "BEGIN:VCALENDAR\r\nDESCRIPTION:" + "x".repeat(100) + "\r\nEND:VCALENDAR\r\n";
    const result = validateIcs(brokenIcs);
    expect(result.issues.some((i) => i.includes("75 octets"))).toBe(true);
  });
});
