import { randomBytes, randomInt } from "node:crypto";

/** The raw secret handed to a caller once, at mint time — never stored, only its hash is (see @prefab/db's hashToken). */
export function generateRawToken(): string {
  return `pf_${randomBytes(24).toString("base64url")}`;
}

/** A 6-digit email-verification code (Slice 3 signup) — short enough to type from an inbox, hashed the same way a session/API token is. */
export function generateVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
