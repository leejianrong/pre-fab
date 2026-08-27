import { ulid } from "ulid";
import { z } from "zod";

/**
 * Every addressable thing in a document — sites, pages, blocks, themes,
 * assets — is keyed by a ULID, never by position. ADR-0002: "an agent patch
 * never has to say 'the third block'."
 */
export const UlidSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "must be a valid ULID");

export type Ulid = z.infer<typeof UlidSchema>;

export function newUlid(): Ulid {
  return ulid();
}

export function isUlid(value: unknown): value is Ulid {
  return typeof value === "string" && UlidSchema.safeParse(value).success;
}
