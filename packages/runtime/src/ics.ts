/**
 * RFC 5545 (iCalendar) generation and validation — its own module because a
 * malformed ICS attachment silently fails to import into a visitor's
 * calendar app rather than erroring loudly (SLICES.md), so this needs unit
 * coverage independent of anything email- or booking-flow-shaped. Kept
 * dependency-free, matching every other pure module in this package.
 */

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

/** `YYYYMMDDTHHMMSSZ` — the one DATE-TIME form this module ever emits, always UTC, never a floating or zone-qualified local time (side-steps needing VTIMEZONE blocks entirely). */
export function formatIcsUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** RFC 5545 §3.3.11 TEXT escaping — backslash, semicolon and comma are structural delimiters; a literal newline must become the two-character `\n`. Order matters: backslash first, or the escapes just written would themselves get re-escaped. */
export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** RFC 5545 §3.1 line folding: a physical line may not exceed 75 octets; a longer one is split with CRLF followed by a single leading space, which the reader is required to strip back out. */
export function foldIcsLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  let first = true;
  while (rest.length > 0) {
    const width = first ? 75 : 74; // a continuation line's leading space itself counts toward its own 75-octet budget
    parts.push(rest.slice(0, width));
    rest = rest.slice(width);
    first = false;
  }
  return parts.join("\r\n ");
}

export interface IcsEventInput {
  uid: string;
  startsAtMs: number;
  endsAtMs: number;
  summary: string;
  description?: string;
  location?: string;
  organizerEmail: string;
  organizerName?: string;
  attendeeEmail: string;
  attendeeName?: string;
  /** Bumped on every reschedule so calendar apps update the existing event instead of creating a duplicate (RFC 5545 §3.8.7.4). */
  sequence?: number;
  /** REQUEST for a new/updated booking, CANCEL for a cancellation notice — both are "a calendar invite" (SLICES.md), just opposite directions. */
  method: "REQUEST" | "CANCEL";
  /** Injectable for tests — DTSTAMP is "when this ICS was generated," never derived from startsAtMs. */
  generatedAtMs?: number;
}

/**
 * One VEVENT wrapped in one VCALENDAR — deliberately not a VTIMEZONE-bearing
 * multi-day recurring series (ADR-0009's "small booking core" scope): every
 * timestamp is UTC (`formatIcsUtc`), which every mainstream calendar client
 * renders correctly in the recipient's own local zone with no VTIMEZONE
 * block required at all.
 */
export function generateBookingIcs(input: IcsEventInput): string {
  const dtstamp = formatIcsUtc(input.generatedAtMs ?? Date.now());
  const attendeeParams = input.attendeeName ? `;CN=${escapeIcsText(input.attendeeName)};RSVP=TRUE` : ";RSVP=TRUE";
  const organizerParams = input.organizerName ? `;CN=${escapeIcsText(input.organizerName)}` : "";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//pre-fab//Booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${formatIcsUtc(input.startsAtMs)}`,
    `DTEND:${formatIcsUtc(input.endsAtMs)}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
  ];
  if (input.description) lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escapeIcsText(input.location)}`);
  lines.push(`ORGANIZER${organizerParams}:mailto:${input.organizerEmail}`);
  lines.push(`ATTENDEE${attendeeParams}:mailto:${input.attendeeEmail}`);
  lines.push(`SEQUENCE:${input.sequence ?? 0}`);
  lines.push(`STATUS:${input.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`);
  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

export interface IcsValidationResult {
  valid: boolean;
  issues: string[];
}

const REQUIRED_LINE_PREFIXES = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:",
  "BEGIN:VEVENT",
  "UID:",
  "DTSTAMP:",
  "DTSTART",
  "DTEND",
  "SUMMARY:",
  "END:VEVENT",
  "END:VCALENDAR",
];

const UTC_DATE_TIME = /:\d{8}T\d{6}Z$/;

/**
 * Structural validity only — not a full RFC 5545 parser, but enough to
 * catch exactly the mistakes that make a calendar app silently refuse to
 * import an attachment: missing CRLF line endings, a required property
 * absent, DTSTART/DTEND not in UTC form, an unfolded line over 75 octets,
 * or a VCALENDAR/VEVENT that doesn't actually open and close in order.
 */
export function validateIcs(ics: string): IcsValidationResult {
  const issues: string[] = [];

  if (ics.includes("\n") && !ics.includes("\r\n")) {
    issues.push("lines must be terminated with CRLF, not bare LF");
  }

  const physicalLines = ics.split("\r\n").filter((line, index, all) => !(index === all.length - 1 && line === ""));
  for (const [index, line] of physicalLines.entries()) {
    if (Buffer.byteLength(line, "utf8") > 75) {
      issues.push(`line ${index + 1} exceeds 75 octets and must be folded`);
    }
  }

  // Unfold: a continuation line starts with a single space or tab.
  const logicalLines: string[] = [];
  for (const line of physicalLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && logicalLines.length > 0) {
      logicalLines[logicalLines.length - 1] += line.slice(1);
    } else {
      logicalLines.push(line);
    }
  }

  if (logicalLines[0] !== "BEGIN:VCALENDAR") issues.push("must start with BEGIN:VCALENDAR");
  if (logicalLines[logicalLines.length - 1] !== "END:VCALENDAR") issues.push("must end with END:VCALENDAR");

  for (const prefix of REQUIRED_LINE_PREFIXES) {
    if (!logicalLines.some((line) => line.startsWith(prefix))) {
      issues.push(`missing required line starting with "${prefix}"`);
    }
  }

  const dtstart = logicalLines.find((line) => line.startsWith("DTSTART"));
  const dtend = logicalLines.find((line) => line.startsWith("DTEND"));
  if (dtstart && !UTC_DATE_TIME.test(dtstart)) issues.push("DTSTART must be a UTC date-time (YYYYMMDDTHHMMSSZ)");
  if (dtend && !UTC_DATE_TIME.test(dtend)) issues.push("DTEND must be a UTC date-time (YYYYMMDDTHHMMSSZ)");
  if (dtstart && dtend) {
    const start = dtstart.slice(dtstart.indexOf(":") + 1);
    const end = dtend.slice(dtend.indexOf(":") + 1);
    if (end <= start) issues.push("DTEND must be after DTSTART");
  }

  const veventOpens = logicalLines.filter((l) => l === "BEGIN:VEVENT").length;
  const veventCloses = logicalLines.filter((l) => l === "END:VEVENT").length;
  if (veventOpens !== veventCloses) issues.push("unbalanced BEGIN:VEVENT/END:VEVENT");

  return { valid: issues.length === 0, issues };
}
