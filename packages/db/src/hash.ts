import { createHash } from "node:crypto";

/** api_tokens and sessions store only this — the raw secret is shown once, at creation. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
