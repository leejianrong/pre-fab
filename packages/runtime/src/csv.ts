/**
 * RFC 4180-shaped: a field is quoted whenever it contains the delimiter, a
 * quote, or a newline, and an embedded quote is doubled. Pure and
 * dependency-free so both the hosted API and, eventually, the self-host
 * runtime can export identically.
 */
function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(columns: string[], rows: Array<Record<string, string>>): string {
  const lines = [columns.map(escapeCsvField).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvField(row[column] ?? "")).join(","));
  }
  // CRLF per RFC 4180 — the format most spreadsheet tools expect.
  return lines.join("\r\n") + "\r\n";
}
