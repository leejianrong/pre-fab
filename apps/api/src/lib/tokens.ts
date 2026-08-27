import { randomBytes } from "node:crypto";

/** The raw secret handed to a caller once, at mint time — never stored, only its hash is (see @prefab/db's hashToken). */
export function generateRawToken(): string {
  return `pf_${randomBytes(24).toString("base64url")}`;
}
