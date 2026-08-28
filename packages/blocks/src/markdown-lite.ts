/**
 * A deliberately small Markdown subset for post bodies (Slice 5) — headings
 * (`#`/`##`/`###`), paragraphs and `-`/`*` bullet lists. Parsed into a plain
 * data structure and rendered as real React elements (never
 * `dangerouslySetInnerHTML`), the same "no HTML parsing, no XSS surface"
 * choice the richtext block already makes — widening this later doesn't
 * need a prop or storage-format change, only a richer parser here.
 */
export type MarkdownLiteBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

export function parseMarkdownLite(body: string): MarkdownLiteBlock[] {
  const blocks: MarkdownLiteBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraphLines.join(" ").trim() });
      paragraphLines = [];
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ kind: "list", items: listItems });
      listItems = [];
    }
  };

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: headingMatch[1]!.length as 1 | 2 | 3, text: headingMatch[2]!.trim() });
      continue;
    }
    const listMatch = /^[-*]\s+(.*)$/.exec(line);
    if (listMatch) {
      flushParagraph();
      listItems.push(listMatch[1]!.trim());
      continue;
    }
    flushList();
    paragraphLines.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Plain-text summary for a list view's excerpt — strips markup, collapses whitespace, and truncates on a word boundary. */
export function plainTextExcerpt(body: string, maxLength = 160): string {
  const text = body
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${(lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trimEnd()}…`;
}
