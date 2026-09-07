import type { Page } from "@playwright/test";

export interface ConsoleEvent {
  kind: "console-error" | "pageerror";
  text: string;
  location?: string;
  at: string;
}

/**
 * Buffers `console.error` and uncaught `pageerror` events for a page so a
 * scenario can check "did anything go wrong under the hood" at whatever
 * point it chooses — the `console --errors` REPL command drains this and
 * clears it, matching the card's framing: "a page can render its shell
 * while every data fetch 500s underneath," which a screenshot alone would
 * never reveal.
 */
export class ConsoleErrorBuffer {
  private events: ConsoleEvent[] = [];

  constructor(page: Page) {
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const loc = message.location();
      this.events.push({
        kind: "console-error",
        text: message.text(),
        location: loc.url ? `${loc.url}:${loc.lineNumber}:${loc.columnNumber}` : undefined,
        at: new Date().toISOString(),
      });
    });
    page.on("pageerror", (error) => {
      this.events.push({ kind: "pageerror", text: error.message, at: new Date().toISOString() });
    });
  }

  /** Returns everything buffered since the last drain, and clears the buffer. */
  drain(): ConsoleEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }
}
